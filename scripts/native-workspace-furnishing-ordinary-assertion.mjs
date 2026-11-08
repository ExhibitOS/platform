// SPDX-License-Identifier: AGPL-3.0-or-later
// Framing and authentication only. A valid frame does not by itself prove that
// the native lifecycle transition was persisted or the writer lock is held.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

const kinds=['furnishing-ordinary-admission','furnishing-ordinary-admission-ack','furnishing-ordinary-stop','furnishing-ordinary-drained'];
const admissions=['fresh-empty','clean-reopen','verified-restore','catalog-upgrade-039-to-040','catalog-upgrade-040-to-044'];
const keys=['runtimeGeneration','leaseTranscriptSHA256','admissionKind','activeBindingSHA256'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const proofKeys=['restoreId','backupId','authenticatedManifestSha256','sourceDatabaseSystemId','sourceDatabaseOid','targetDatabaseSystemId','targetDatabaseOid','provenanceRowCount','provenanceTableSha256'];
const decimal=/^[1-9][0-9]{0,19}$/;
const invalid=()=>Error('FURNISHING_ADMISSION_INVALID');
function checkedProof(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==proofKeys.length||proofKeys.some(k=>!Object.hasOwn(value,k))||![value.restoreId,value.backupId].every(v=>typeof v==='string'&&uuid.test(v))||![value.authenticatedManifestSha256,value.provenanceTableSha256].every(v=>typeof v==='string'&&hash.test(v))||![value.sourceDatabaseSystemId,value.sourceDatabaseOid,value.targetDatabaseSystemId,value.targetDatabaseOid].every(v=>typeof v==='string'&&decimal.test(v)&&BigInt(v)<=18446744073709551615n)||!Number.isSafeInteger(value.provenanceRowCount)||value.provenanceRowCount<0||value.sourceDatabaseSystemId===value.targetDatabaseSystemId)throw invalid();
 return Object.fromEntries(proofKeys.map(k=>[k,value[k]]));
}
function checked(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length+(Object.hasOwn(value,'restoreProof')?1:0)||keys.some(k=>!Object.hasOwn(value,k))||typeof value.runtimeGeneration!=='string'||!uuid.test(value.runtimeGeneration)||typeof value.leaseTranscriptSHA256!=='string'||!hash.test(value.leaseTranscriptSHA256)||!admissions.includes(value.admissionKind)||typeof value.activeBindingSHA256!=='string'||!hash.test(value.activeBindingSHA256))throw invalid();
 const result=Object.fromEntries(keys.map(k=>[k,value[k]]));
 if(Object.hasOwn(value,'restoreProof')){if(!['verified-restore','clean-reopen'].includes(value.admissionKind))throw invalid();result.restoreProof=checkedProof(value.restoreProof);}
 return result;
}
function mac(kind,value,secret){
 if(!kinds.includes(kind)||!Buffer.isBuffer(secret)||secret.length!==32)throw invalid();
 const version=value.restoreProof?2:1;
 return createHmac('sha256',secret).update(Buffer.concat([Buffer.from(`ExhibitOS/workspace-furnishing/${kind}/v${version}\0`,'ascii'),Buffer.from(value.runtimeGeneration.replaceAll('-',''),'hex'),Buffer.from(value.leaseTranscriptSHA256,'hex'),Buffer.from([admissions.indexOf(value.admissionKind)+1]),Buffer.from(value.activeBindingSHA256,'hex'),...(value.restoreProof?[createHash('sha256').update(JSON.stringify(value.restoreProof),'utf8').digest()]:[])])).digest('hex');
}
export function encodeFurnishingOrdinaryAssertion(kind,fields,secret){
 const value=checked(fields);return Buffer.from(JSON.stringify({version:value.restoreProof?2:1,kind,...value,mac:mac(kind,value,secret)}),'utf8');
}
export function authenticateFurnishingOrdinaryAssertion(bytes,kind,secret){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>2048||!kinds.includes(kind))throw invalid();
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||![1,2].includes(value.version)||value.kind!==kind||typeof value.mac!=='string'||!hash.test(value.mac))throw invalid();
 const fields=checked({...Object.fromEntries(keys.map(key=>[key,value[key]])),...(value.version===2?{restoreProof:value.restoreProof}:{})}),canonical=Buffer.from(JSON.stringify({version:value.version,kind,...fields,mac:value.mac}),'utf8');
 if(!Buffer.from(bytes).equals(canonical)||!timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(mac(kind,fields,secret),'hex')))throw invalid();
 return fields;
}
export function verifyFurnishingOrdinaryAssertion(bytes,kind,expected,secret){
 const value=authenticateFurnishingOrdinaryAssertion(bytes,kind,secret),bound=checked(expected);if(JSON.stringify(value)!==JSON.stringify(bound))throw invalid();return value;
}
