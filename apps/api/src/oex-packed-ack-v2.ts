// SPDX-License-Identifier: AGPL-3.0-or-later
import {decodePackedOexDocumentsV2} from './oex-packed-documents-v2.ts';
import {packedOexInventory} from './oex-packed-output.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const decimal=/^(0|[1-9][0-9]{0,23})$/;
type Expected={attemptId:string;runtimeGeneration:string;reservationId:string;reservationGeneration:string;controlSha256:string;archiveSha256:string;outputDevice:string;outputInode:string;capacity:number};
/** Syntactic/document/inventory verification only. Expected values must be
 * derived by the caller from the verified owned control and live claim, not
 * the ACK. Caller still owns actual process drain, Session/fence, reservation,
 * per-entry content checks, authorization and atomic attachment. */
export function parsePackedOexAckV2(raw:Uint8Array,expected:Expected){
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>4*1024*1024||!expected||![expected.attemptId,expected.runtimeGeneration,expected.reservationId,expected.reservationGeneration].every(v=>typeof v==='string'&&uuid.test(v))||![expected.controlSha256,expected.archiveSha256].every(v=>typeof v==='string'&&hex.test(v))||![expected.outputDevice,expected.outputInode].every(v=>typeof v==='string'&&decimal.test(v))||!Number.isSafeInteger(expected.capacity)||expected.capacity<0||expected.capacity>512*1024*1024)throw Error('OEX_PACKED_ACK');
 let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_PACKED_ACK');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PACKED_ACK');
 const v=value as Record<string,unknown>,keys=['version','kind','status','attemptId','runtimeGeneration','reservationId','reservationGeneration','receiptSha256','archiveSha256','manifestSha256','exhibitionSha256','manifestBase64','exhibitionBase64','outputDevice','outputInode','outputBytes','entries'];
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]])))||v.version!==2||v.kind!=='prepared'||v.status!=='complete'||v.attemptId!==expected.attemptId||v.runtimeGeneration!==expected.runtimeGeneration||v.reservationId!==expected.reservationId||v.reservationGeneration!==expected.reservationGeneration||v.receiptSha256!==expected.controlSha256||v.archiveSha256!==expected.archiveSha256||v.outputDevice!==expected.outputDevice||v.outputInode!==expected.outputInode||!Number.isSafeInteger(v.outputBytes)||Number(v.outputBytes)<0||Number(v.outputBytes)>expected.capacity||typeof v.manifestSha256!=='string'||!hex.test(v.manifestSha256)||typeof v.exhibitionSha256!=='string'||!hex.test(v.exhibitionSha256)||typeof v.manifestBase64!=='string'||typeof v.exhibitionBase64!=='string'||!Array.isArray(v.entries))throw Error('OEX_PACKED_ACK');
 const decode=(text:string)=>{if(text.length>1398104)throw Error('OEX_PACKED_ACK');const b=Buffer.from(text,'base64');if(b.length<1||b.length>1024*1024||b.toString('base64')!==text)throw Error('OEX_PACKED_ACK');return b;};
 const documents=decodePackedOexDocumentsV2(decode(v.manifestBase64),v.manifestSha256,decode(v.exhibitionBase64),v.exhibitionSha256),inventory=packedOexInventory(documents.manifest),seen=new Set<string>();let total=0;
 if(v.entries.length!==inventory.size)throw Error('OEX_PACKED_ACK');
 const entries=v.entries.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('OEX_PACKED_ACK');const e=item as Record<string,unknown>;
  if(Object.keys(e).join(',')!=='path,offset,bytes,sha256'||typeof e.path!=='string'||seen.has(e.path)||!Number.isSafeInteger(e.offset)||e.offset!==total||!Number.isSafeInteger(e.bytes)||Number(e.bytes)<1||Number(e.bytes)>expected.capacity-total||typeof e.sha256!=='string')throw Error('OEX_PACKED_ACK');
  const want=inventory.get(e.path);if(!want||want.bytes!==e.bytes||want.sha256!==e.sha256)throw Error('OEX_PACKED_ACK');seen.add(e.path);total+=Number(e.bytes);return Object.freeze({path:e.path,offset:Number(e.offset),bytes:Number(e.bytes),sha256:e.sha256});
 });
 if(total!==v.outputBytes)throw Error('OEX_PACKED_ACK');return Object.freeze({...documents,entries:Object.freeze(entries),outputBytes:total});
}
