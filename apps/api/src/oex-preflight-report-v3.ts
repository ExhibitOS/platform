// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {parseOexPreflightAck} from './oex-preflight-ack.ts';
const reportKeys=['version','kind','correlationId','attemptId','runtimeGeneration','stageId','controlBase64','controlSha256','ackBase64','ackSha256'] as const;
const controlKeys=['version','kind','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','reservationDigest','archiveBytes','archiveSha256','inputDevice','inputInode'] as const;
const expectedKeys=['correlationId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','reservationDigest','archiveBytes','archiveSha256','inputDevice','inputInode'] as const;
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[a-f0-9]{64}$/,decimal=/^(0|[1-9][0-9]{0,23})$/;
type Expected={correlationId:string;attemptId:string;runtimeGeneration:string;stageId:string;reservationId:string;reservationGeneration:string;reservationDigest:string;archiveBytes:number;archiveSha256:string;inputDevice:string;inputInode:string};
/** A report is an authenticated Manager assertion only when received on the
 * same live owner channel. This parser does not prove child reap, a live FD,
 * a provider lease, or permission to write. */
export function parseOexPreflightReportV3(raw:Uint8Array,expected:Expected){
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||!expected||typeof expected!=='object'||Reflect.ownKeys(expected).length!==expectedKeys.length||expectedKeys.some(k=>{const d=Object.getOwnPropertyDescriptor(expected,k);return !d||!d.enumerable||!Object.hasOwn(d,'value');})||![expected.correlationId,expected.attemptId,expected.runtimeGeneration,expected.stageId,expected.reservationId,expected.reservationGeneration].every(v=>typeof v==='string'&&uuid.test(v))||![expected.reservationDigest,expected.archiveSha256].every(v=>typeof v==='string'&&hash.test(v))||![expected.inputDevice,expected.inputInode].every(v=>typeof v==='string'&&decimal.test(v))||!Number.isSafeInteger(expected.archiveBytes)||expected.archiveBytes<1||expected.archiveBytes>512*1024*1024)throw Error('OEX_PREFLIGHT_REPORT');
 let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('OEX_PREFLIGHT_REPORT');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_PREFLIGHT_REPORT');const r=value as Record<string,unknown>;
 if(Object.keys(r).length!==reportKeys.length||reportKeys.some((k,i)=>Object.keys(r)[i]!==k)||source!==JSON.stringify(Object.fromEntries(reportKeys.map(k=>[k,r[k]])))||r.version!==1||r.kind!=='preflight-report-v3'||r.correlationId!==expected.correlationId||r.attemptId!==expected.attemptId||r.runtimeGeneration!==expected.runtimeGeneration||r.stageId!==expected.stageId||typeof r.controlSha256!=='string'||!hash.test(r.controlSha256)||typeof r.ackSha256!=='string'||!hash.test(r.ackSha256))throw Error('OEX_PREFLIGHT_REPORT');
 const decode=(value:unknown)=>{if(typeof value!=='string'||value.length>2732)throw Error('OEX_PREFLIGHT_REPORT');const bytes=Buffer.from(value,'base64');if(bytes.length<1||bytes.length>2048||bytes.toString('base64')!==value)throw Error('OEX_PREFLIGHT_REPORT');return bytes;};
 const control=decode(r.controlBase64),ack=decode(r.ackBase64);if(sha(control)!==r.controlSha256||sha(ack)!==r.ackSha256)throw Error('OEX_PREFLIGHT_REPORT');
 let controlText:string,c:Record<string,unknown>;try{controlText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(control);const v:unknown=JSON.parse(controlText);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid');c=v as Record<string,unknown>;}catch{throw Error('OEX_PREFLIGHT_REPORT');}
 if(Object.keys(c).length!==controlKeys.length||controlKeys.some((k,i)=>Object.keys(c)[i]!==k)||controlText!==JSON.stringify(Object.fromEntries(controlKeys.map(k=>[k,c[k]])))||c.version!==1||c.kind!=='oex-preflight-v1'||expectedKeys.filter(k=>k!=='correlationId').some(k=>c[k]!==expected[k]))throw Error('OEX_PREFLIGHT_REPORT');
 const evidence=parseOexPreflightAck(ack,{attemptId:expected.attemptId,runtimeGeneration:expected.runtimeGeneration,stageId:expected.stageId,reservationId:expected.reservationId,reservationGeneration:expected.reservationGeneration,controlSha256:r.controlSha256,archiveBytes:expected.archiveBytes,archiveSha256:expected.archiveSha256,inputDevice:expected.inputDevice,inputInode:expected.inputInode});
 return Object.freeze({reportSha256:sha(raw),evidence});
}
