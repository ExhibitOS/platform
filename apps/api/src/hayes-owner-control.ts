// SPDX-License-Identifier: AGPL-3.0-or-later
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';

// This codec owns no authentication, DB claim, worker or drain authority. The
// caller supplies pins from its already authenticated, live Manager session.
type Channel={send(frame:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=/^[a-f0-9]{64}$/;
const invalid=()=>new Error('HAYES_CONTROL_INVALID');
const OPEN_KEYS=['version','kind','binding','nativeOwnerId','runtimeManifestSha256'] as const;
const CHALLENGE_KEYS=['version','kind','binding','challenge','runtimeManifestSha256'] as const;
function parse(raw:Uint8Array,keys:readonly string[]):Record<string,unknown>{
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw invalid();
 try{
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),v:unknown=JSON.parse(text);
  if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();const r=v as Record<string,unknown>;
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||text!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,r[k]]))))throw invalid();
  const binding=parseHayesOperationBinding(r.binding);if(JSON.stringify(binding)!==JSON.stringify(r.binding))throw invalid();
  return r;
 }catch{throw invalid();}
}
export function createHayesOwnerControl(input:{binding:unknown;nativeOwnerId:string;runtimeManifestSha256:string;channel:Channel;signal:AbortSignal;deadlineMs:number;revalidateCommitted:(binding:HayesOperationBinding)=>Promise<void>}){
 const binding=parseHayesOperationBinding(input.binding),{nativeOwnerId,runtimeManifestSha256,channel,signal,deadlineMs,revalidateCommitted}=input;
 if(!uuid.test(nativeOwnerId)||!sha.test(runtimeManifestSha256)||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||!signal||!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now()||deadlineMs>Date.now()+300000||typeof revalidateCommitted!=='function')throw invalid();
 let state:'open'|'source'|'done'|'failed'='open',busy=false,closed:Promise<void>|undefined;
 const check=()=>{signal.throwIfAborted();if(state==='failed'||Date.now()>=deadlineMs)throw invalid();};
 async function bounded<T>(start:()=>Promise<T>):Promise<T>{
  check();let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(invalid()),Math.max(0,deadlineMs-Date.now()));abort=()=>reject(signal.reason??invalid());signal.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([Promise.resolve().then(()=>{check();return start();}),interrupted]);check();return result;}finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 async function fail(cause:unknown):Promise<never>{
  state='failed';if(!closed)closed=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(()=>channel.close()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(invalid()),3000);})]);}finally{if(timer)clearTimeout(timer);}})();
  try{await closed;}catch{throw new Error('HAYES_CONTROL_CLOSE_UNCERTAIN',{cause});}throw cause;
 }
 const send=async(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>8192)throw invalid();try{await bounded(()=>channel.send(Buffer.from(bytes)));}finally{bytes.fill(0);}};
 const receive=async(keys:readonly string[])=>parse(await bounded(()=>channel.receive()),keys);
 const same=(x:unknown)=>JSON.stringify(x)===JSON.stringify(binding);
 return Object.freeze({
  async open():Promise<void>{
   if(state!=='open'||busy)return await fail(invalid());busy=true;try{
    await send({version:1,kind:'hayes-operation-open',binding});const reply=await receive(OPEN_KEYS);
    if(reply.version!==1||reply.kind!=='hayes-operation-open-accepted'||!same(reply.binding)||reply.nativeOwnerId!==nativeOwnerId||reply.runtimeManifestSha256!==runtimeManifestSha256)throw invalid();check();state='source';
   }catch(cause){return await fail(cause);}finally{busy=false;}
  },
  /** Call only after the exact source transfer ACK, on the same owned channel. */
  async revalidate():Promise<void>{
   if(state!=='source'||busy)return await fail(invalid());busy=true;try{
    const challenge=await receive(CHALLENGE_KEYS);
    if(challenge.version!==1||challenge.kind!=='hayes-operation-revalidate'||!same(challenge.binding)||typeof challenge.challenge!=='string'||!uuid.test(challenge.challenge)||challenge.runtimeManifestSha256!==runtimeManifestSha256)throw invalid();
    await bounded(()=>revalidateCommitted(binding));
    await send({version:1,kind:'hayes-operation-revalidated',binding,challenge:challenge.challenge,runtimeManifestSha256});check();state='done';
   }catch(cause){return await fail(cause);}finally{busy=false;}
  },
 });
}
