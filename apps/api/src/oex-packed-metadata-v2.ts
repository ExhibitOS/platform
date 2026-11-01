// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
type Channel={send(value:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};
function exact(raw:Uint8Array,keys:string[]):Record<string,unknown>{
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_PACKED_METADATA');
 let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_PACKED_METADATA');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PACKED_METADATA');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]]))))throw Error('OEX_PACKED_METADATA');
 return v;
}
/** Receives the exact ACK retained by the Manager after its direct child has
 * exited. A matching digest supplies byte integrity only: the caller must hold
 * and revalidate the same live Session, fence, claim and reservation, verify
 * worker drain independently, and parse and validate the returned ACK. */
export async function receivePackedOexMetadataV2(channel:Channel,announcement:Uint8Array,operationCorrelationId:string,attemptId:string):Promise<Buffer>{
 let bytes:Buffer|undefined;
 try{
  if(!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||!uuid.test(operationCorrelationId)||!uuid.test(attemptId))throw Error('OEX_PACKED_METADATA');
  const ready=exact(announcement,['version','kind','correlationId','attemptId','bytes','sha256']);
  if(ready.version!==1||ready.kind!=='metadata-ready'||ready.correlationId!==operationCorrelationId||ready.attemptId!==attemptId||!Number.isSafeInteger(ready.bytes)||Number(ready.bytes)<1||Number(ready.bytes)>4*1024*1024||typeof ready.sha256!=='string'||!hex.test(ready.sha256))throw Error('OEX_PACKED_METADATA');
  bytes=Buffer.alloc(Number(ready.bytes));let offset=0;
  while(offset<bytes.length){
   const length=Math.min(4096,bytes.length-offset),correlationId=randomUUID();
   await channel.send(Buffer.from(JSON.stringify({version:1,kind:'read-metadata',correlationId,attemptId,offset,length})));
   const response=exact(await channel.receive(),['version','kind','correlationId','attemptId','offset','data']);
   if(response.version!==1||response.kind!=='metadata-chunk'||response.correlationId!==correlationId||response.attemptId!==attemptId||response.offset!==offset||typeof response.data!=='string')throw Error('OEX_PACKED_METADATA');
   const part=Buffer.from(response.data,'base64');if(part.length!==length||part.toString('base64')!==response.data)throw Error('OEX_PACKED_METADATA');part.copy(bytes,offset);offset+=length;
  }
  if(createHash('sha256').update(bytes).digest('hex')!==ready.sha256)throw Error('OEX_PACKED_METADATA');
  return bytes;
 }catch(error){bytes?.fill(0);if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}
}
