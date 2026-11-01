// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {encodeDiskReservationReceipt,type DiskReservationReceipt} from './publication-disk-budget.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
type Channel={send(value:Uint8Array):Promise<void>;receive():Promise<Uint8Array>;close():Promise<void>};
/** Send the provider receipt already acquired by the live claimant. This
 * transport does not prove that it remains active or bind a reservation;
 * caller holds the same Session/fence and independently verifies the provider
 * before binding and commit. It owns the channel exclusively until return. */
export async function sendOexReservationReceipt(channel:Channel,receipt:DiskReservationReceipt,operationCorrelationId:string,attemptId:string,expectedDigest:string):Promise<void>{
 try{
  if(!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||!uuid.test(operationCorrelationId)||!uuid.test(attemptId)||!hex.test(expectedDigest))throw Error('OEX_RESERVATION_WIRE');
  const bytes=encodeDiskReservationReceipt(receipt);if(bytes.length<1||bytes.length>32768||createHash('sha256').update(bytes).digest('hex')!==expectedDigest)throw Error('OEX_RESERVATION_WIRE');
  await channel.send(Buffer.from(JSON.stringify({version:1,kind:'receipt-ready',correlationId:operationCorrelationId,attemptId,bytes:bytes.length,sha256:expectedDigest})));
  let offset=0;const seen=new Set<string>();
  while(offset<bytes.length){
   const raw=await channel.receive();if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('OEX_RESERVATION_WIRE');
   let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_RESERVATION_WIRE');}
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_RESERVATION_WIRE');
   const v=value as Record<string,unknown>,keys=['version','kind','correlationId','attemptId','offset','length'],length=Math.min(4096,bytes.length-offset);
   if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]])))||v.version!==1||v.kind!=='read-receipt'||typeof v.correlationId!=='string'||!uuid.test(v.correlationId)||seen.has(v.correlationId)||v.attemptId!==attemptId||v.offset!==offset||v.length!==length)throw Error('OEX_RESERVATION_WIRE');
   seen.add(v.correlationId);await channel.send(Buffer.from(JSON.stringify({version:1,kind:'receipt-chunk',correlationId:v.correlationId,attemptId,offset,data:bytes.subarray(offset,offset+length).toString('base64')})));offset+=length;
  }
 }catch(error){if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}
}
