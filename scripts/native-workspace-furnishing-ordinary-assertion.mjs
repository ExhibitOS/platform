// SPDX-License-Identifier: AGPL-3.0-or-later
// Framing and authentication only. A valid frame does not by itself prove that
// the native lifecycle transition was persisted or the writer lock is held.
import {createHmac,timingSafeEqual} from 'node:crypto';

const kinds=['furnishing-ordinary-admission','furnishing-ordinary-admission-ack','furnishing-ordinary-stop','furnishing-ordinary-drained'];
const admissions=['fresh-empty','clean-reopen','verified-restore'];
const keys=['runtimeGeneration','leaseTranscriptSHA256','admissionKind','activeBindingSHA256'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const invalid=()=>Error('FURNISHING_ADMISSION_INVALID');
function checked(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||typeof value.runtimeGeneration!=='string'||!uuid.test(value.runtimeGeneration)||typeof value.leaseTranscriptSHA256!=='string'||!hash.test(value.leaseTranscriptSHA256)||!admissions.includes(value.admissionKind)||typeof value.activeBindingSHA256!=='string'||!hash.test(value.activeBindingSHA256))throw invalid();
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
function mac(kind,value,secret){
 if(!kinds.includes(kind)||!Buffer.isBuffer(secret)||secret.length!==32)throw invalid();
 return createHmac('sha256',secret).update(Buffer.concat([Buffer.from(`ExhibitOS/workspace-furnishing/${kind}/v1\0`,'ascii'),Buffer.from(value.runtimeGeneration.replaceAll('-',''),'hex'),Buffer.from(value.leaseTranscriptSHA256,'hex'),Buffer.from([admissions.indexOf(value.admissionKind)+1]),Buffer.from(value.activeBindingSHA256,'hex')])).digest('hex');
}
export function encodeFurnishingOrdinaryAssertion(kind,fields,secret){
 const value=checked(fields);return Buffer.from(JSON.stringify({version:1,kind,...value,mac:mac(kind,value,secret)}),'utf8');
}
export function authenticateFurnishingOrdinaryAssertion(bytes,kind,secret){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>2048||!kinds.includes(kind))throw invalid();
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||value.kind!==kind||typeof value.mac!=='string'||!hash.test(value.mac))throw invalid();
 const fields=checked(Object.fromEntries(keys.map(key=>[key,value[key]]))),canonical=Buffer.from(JSON.stringify({version:1,kind,...fields,mac:value.mac}),'utf8');
 if(!Buffer.from(bytes).equals(canonical)||!timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(mac(kind,fields,secret),'hex')))throw invalid();
 return fields;
}
export function verifyFurnishingOrdinaryAssertion(bytes,kind,expected,secret){
 const value=authenticateFurnishingOrdinaryAssertion(bytes,kind,secret),bound=checked(expected);if(keys.some(key=>value[key]!==bound[key]))throw invalid();return value;
}
