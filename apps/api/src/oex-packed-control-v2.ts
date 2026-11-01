// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decimal=/^(0|[1-9][0-9]{0,23})$/;
const hex=/^[a-f0-9]{64}$/;
const keys=['version','kind','tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','archiveBytes','archiveSha256','capacity','inputDevice','inputInode','outputDevice','outputInode','reservationDigest','sourceDigest','workerDigest','profile','format'] as const;
type Name=(typeof keys)[number];
type Expected=Record<Exclude<Name,'version'|'kind'|'outputInode'|'profile'|'format'>,string|number>&{correlationId:string};
/** Bind Manager's exact control to independent live claim/provider inputs.
 * Caller verifies workspace/stage pin, no other writer, child drain and
 * compiled worker identity; this parsing does not establish any of them. */
export function parsePackedOexControlV2(raw:Uint8Array,expected:Expected){
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||!expected||typeof expected.correlationId!=='string'||!uuid.test(expected.correlationId))throw Error('OEX_PACKED_CONTROL');
 let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_PACKED_CONTROL');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PACKED_CONTROL');
 const outer=value as Record<string,unknown>,outerKeys=['version','kind','correlationId','attemptId','control'];
 if(Object.keys(outer).length!==outerKeys.length||outerKeys.some(k=>!Object.hasOwn(outer,k))||source!==JSON.stringify(Object.fromEntries(outerKeys.map(k=>[k,outer[k]])))||outer.version!==1||outer.kind!=='worker-control'||outer.correlationId!==expected.correlationId||outer.attemptId!==expected.attemptId||!outer.control||typeof outer.control!=='object'||Array.isArray(outer.control))throw Error('OEX_PACKED_CONTROL');
 const c=outer.control as Record<string,unknown>;
 if(Object.keys(c).length!==keys.length||keys.some((k,i)=>Object.keys(c)[i]!==k)||c.version!==2||c.kind!=='oex-packed-v2'||c.profile!=='bounded-file-v1'||c.format!=='1.0.0-draft.9')throw Error('OEX_PACKED_CONTROL');
 for(const key of keys){if(['version','kind','profile','format','outputInode'].includes(key))continue;if(c[key]!==expected[key as keyof Expected])throw Error('OEX_PACKED_CONTROL');}
 for(const key of ['tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration'])if(typeof c[key]!=='string'||!uuid.test(c[key] as string))throw Error('OEX_PACKED_CONTROL');
 for(const key of ['inputDevice','inputInode','outputDevice','outputInode'])if(typeof c[key]!=='string'||!decimal.test(c[key] as string))throw Error('OEX_PACKED_CONTROL');
 for(const key of ['archiveSha256','reservationDigest','sourceDigest','workerDigest'])if(typeof c[key]!=='string'||!hex.test(c[key] as string))throw Error('OEX_PACKED_CONTROL');
 if(!Number.isSafeInteger(c.archiveBytes)||Number(c.archiveBytes)<1||Number(c.archiveBytes)>512*1024*1024||!Number.isSafeInteger(c.capacity)||Number(c.capacity)<0||Number(c.capacity)>512*1024*1024||c.sourceDigest!==c.archiveSha256||c.inputDevice===c.outputDevice&&c.inputInode===c.outputInode)throw Error('OEX_PACKED_CONTROL');
 const bytes=Buffer.from(JSON.stringify(c));return Object.freeze({controlSha256:createHash('sha256').update(bytes).digest('hex'),outputDevice:c.outputDevice as string,outputInode:c.outputInode as string});
}
