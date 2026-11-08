// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {types} from 'node:util';

// Transfer integrity only: the caller must retain its authenticated native
// owner, DB lease, reservation and stage through commit or confirmed discard.
const SOURCE_SHA='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6';
const SOURCE_BYTES=8383096, MAX_OUTPUT=16*1024*1024, CHUNK=4096, MAX_FRAME=8192;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=/^[a-f0-9]{64}$/;
type Direction='source'|'output';
// send takes ownership of its argument; it must settle after consuming it or
// reject on close. The caller must not treat close as a worker-drain proof.
type Channel={send(frame:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};
type Header={version:1;kind:'hayes-transfer-start'|'hayes-transfer-end'|'hayes-transfer-accepted';attemptId:string;correlationId:string;direction:Direction;bytes:number;sha256:string};
type Data={version:1;kind:'hayes-transfer-data';attemptId:string;correlationId:string;direction:Direction;offset:number;data:string};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const error=()=>new Error('HAYES_TRANSFER_INVALID');
const headerKeys=['version','kind','attemptId','correlationId','direction','bytes','sha256'] as const;
const dataKeys=['version','kind','attemptId','correlationId','direction','offset','data'] as const;
function parse(raw:Uint8Array,keys:readonly string[]):Record<string,unknown>{
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>MAX_FRAME)throw error();
 let text:string,value:unknown;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(text);}catch{throw error();}
 if(!value||typeof value!=='object'||Array.isArray(value))throw error();const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||text!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]]))))throw error();
 return v;
}
function packet(value:Header|Data):Buffer{const b=Buffer.from(JSON.stringify(value));if(b.length<1||b.length>MAX_FRAME)throw error();return b;}

/** One source upload followed by one output download on an already bound
 * Manager connection. Input is copied and wiped; successful output belongs to
 * the caller. A verified transfer is not an approval or worker-drain receipt. */
export function createHayesOwnerTransfer(input:{attemptId:string;correlationId:string;channel:Channel;signal:AbortSignal;deadlineMs:number}){
 const {attemptId,correlationId,channel,signal,deadlineMs}=input;
 if(!uuid.test(attemptId)||!uuid.test(correlationId)||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||!signal||!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now()||deadlineMs>Date.now()+300000)throw error();
 let state:'source'|'output'|'done'|'failed'='source',busy=false,closePromise:Promise<void>|undefined;
 const check=()=>{signal.throwIfAborted();if(state==='failed'||Date.now()>=deadlineMs)throw error();};
 async function bounded<T>(start:()=>Promise<T>):Promise<T>{
  check();let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(error()),Math.max(0,deadlineMs-Date.now()));abort=()=>reject(signal.reason??error());signal.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([Promise.resolve().then(()=>{check();return start();}),interrupted]);check();return result;}
  finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 async function invalidate(cause:unknown):Promise<never>{
  state='failed';
  // One close is shared by all failing callers; it is never drain proof.
  if(!closePromise)closePromise=(async()=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([Promise.resolve().then(()=>channel.close()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(error()),3000);})]);}
   finally{if(timer)clearTimeout(timer);}
  })();
  try{await closePromise;}catch{throw new Error('HAYES_TRANSFER_CLOSE_UNCERTAIN',{cause});}
  throw cause;
 }
 const h=(kind:Header['kind'],direction:Direction,bytes:number,sha256:string):Header=>({version:1,kind,attemptId,correlationId,direction,bytes,sha256});
 const send=async(v:Header|Data)=>{const bytes=packet(v);try{await bounded(()=>channel.send(Buffer.from(bytes)));}finally{bytes.fill(0);}};
 const receive=async(keys:readonly string[])=>parse(await bounded(()=>channel.receive()),keys);
 const exact=(v:Record<string,unknown>,expected:Header)=>{if(JSON.stringify(v)!==JSON.stringify(expected))throw error();};
 return Object.freeze({
  async sendSource(inputBytes:Buffer):Promise<void>{
   if(state!=='source'||busy)return await invalidate(error());busy=true;let source:Buffer|undefined;
   try{
    if(!Buffer.isBuffer(inputBytes)||types.isSharedArrayBuffer(inputBytes.buffer)||inputBytes.length!==SOURCE_BYTES)throw error();
    source=Buffer.from(inputBytes);if(digest(source)!==SOURCE_SHA)throw error();
    await send(h('hayes-transfer-start','source',SOURCE_BYTES,SOURCE_SHA));
    for(let offset=0;offset<source.length;offset+=CHUNK){check();const frame:Data={version:1,kind:'hayes-transfer-data',attemptId,correlationId,direction:'source',offset,data:source.subarray(offset,offset+CHUNK).toString('base64')};await send(frame);}
    await send(h('hayes-transfer-end','source',SOURCE_BYTES,SOURCE_SHA));exact(await receive(headerKeys),h('hayes-transfer-accepted','source',SOURCE_BYTES,SOURCE_SHA));check();state='output';
   }catch(cause){source?.fill(0);return await invalidate(cause);}finally{source?.fill(0);busy=false;}
  },
  async receiveOutput():Promise<{bytes:Buffer;sha256:string}>{
   if(state!=='output'||busy)return await invalidate(error());busy=true;let output:Buffer|undefined;
   try{
    const start=await receive(headerKeys),size=start.bytes,hash=start.sha256;
    if(start.version!==1||start.kind!=='hayes-transfer-start'||start.attemptId!==attemptId||start.correlationId!==correlationId||start.direction!=='output'||!Number.isSafeInteger(size)||Number(size)<1||Number(size)>MAX_OUTPUT||typeof hash!=='string'||!sha.test(hash))throw error();
    const n=Number(size);output=Buffer.alloc(n);let offset=0;
    while(offset<n){const v=await receive(dataKeys);if(v.version!==1||v.kind!=='hayes-transfer-data'||v.attemptId!==attemptId||v.correlationId!==correlationId||v.direction!=='output'||v.offset!==offset||typeof v.data!=='string')throw error();const part=Buffer.from(v.data,'base64');try{if(part.length!==Math.min(CHUNK,n-offset)||part.toString('base64')!==v.data)throw error();part.copy(output,offset);offset+=part.length;}finally{part.fill(0);}}
    exact(await receive(headerKeys),h('hayes-transfer-end','output',n,hash));if(digest(output)!==hash)throw error();
    await send(h('hayes-transfer-accepted','output',n,hash));check();state='done';const bytes=output;output=undefined;return {bytes,sha256:hash};
   }catch(cause){output?.fill(0);return await invalidate(cause);}finally{output?.fill(0);busy=false;}
  },
 });
}
