// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';

// Parsing is only a byte-level and shape check. It confers no native
// attestation, positive containment, DB correspondence or release authority.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const keys=(v:unknown,k:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v))===JSON.stringify(k);
const u=(v:unknown)=>typeof v==='string'&&uuid.test(v);
const h=(v:unknown)=>typeof v==='string'&&hash.test(v);
const decimal=(v:unknown,zero:boolean,max:bigint)=>typeof v==='string'&&(zero?/^(0|[1-9][0-9]*)$/:/^[1-9][0-9]*$/).test(v)&&v.length<=20&&BigInt(v)<=max;
const U64=18446744073709551615n,U32=4294967295n;
const size=(v:unknown,max:number)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=max;
const stage=(v:unknown):v is Record<string,unknown>=>keys(v,['stageId','device','inode','bytes','sha256'])&&u(v.stageId)&&decimal(v.device,true,U64)&&decimal(v.inode,false,U64)&&size(v.bytes,16777216)&&h(v.sha256);
const worker=(v:unknown,role:string)=>keys(v,['role','nonce','launchRecordSha256','readyRecordSha256','observationRecordSha256','exitCode'])&&v.role===role&&u(v.nonce)&&h(v.launchRecordSha256)&&h(v.readyRecordSha256)&&h(v.observationRecordSha256)&&v.exitCode===0;
export function parseHayesDispositionReceipt(bytes:Uint8Array){
 try{
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>6144)throw Error();
  const snapshot=Buffer.from(bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(snapshot),v:unknown=JSON.parse(text);
  if(!Buffer.from(text,'utf8').equals(snapshot))throw Error();
  if(!keys(v,['version','outcome','receiptId','binding','nativeOwnerId','runtimeManifestSha256','workerManifestSha256','nativeEvidenceSha256','attestation','dbStageId','originalAssetId','displayAssetId','derivativeId','database'])||JSON.stringify(v)!==text||v.version!==1||v.outcome!=='committed'||!u(v.receiptId)||!u(v.nativeOwnerId)||!h(v.runtimeManifestSha256)||!h(v.workerManifestSha256)||!h(v.nativeEvidenceSha256)||!u(v.dbStageId)||!u(v.originalAssetId)||!u(v.displayAssetId)||v.originalAssetId===v.displayAssetId||!u(v.derivativeId))throw Error();
  if(!keys(v.binding,['version','tenantId','workspaceId','principalId','jobId','leaseId','attemptId','runtimeGeneration','artworkId','correlationId','artworkRevision','sourceSha256','sourceBytes']))throw Error();
  const binding=parseHayesOperationBinding(v.binding);if(binding.artworkRevision>2147483647)throw Error();
  const a=v.attestation;
  if(!keys(a,['source','output','workers','lock','containment'])||!stage(a.source)||!stage(a.output)||a.source.sha256!==binding.sourceSha256||a.source.bytes!==binding.sourceBytes||!Array.isArray(a.workers)||a.workers.length!==2||!worker(a.workers[0],'generate')||!worker(a.workers[1],'validate')||!keys(a.lock,['device','inode'])||!decimal(a.lock.device,true,U64)||!decimal(a.lock.inode,false,U64)||!keys(a.containment,['kind','receiptSha256'])||typeof a.containment.kind!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.containment.kind)||!h(a.containment.receiptSha256))throw Error();
  if(!keys(v.database,['systemIdentifier','databaseOid'])||!decimal(v.database.systemIdentifier,false,U64)||!decimal(v.database.databaseOid,false,U32))throw Error();
  return {value:v,sha256:createHash('sha256').update(snapshot).digest('hex')};
 }catch{throw Error('HAYES_RECEIPT_INVALID');}
}

/** Compare only values already independently obtained by the caller from the
 * locked DB rows and authenticated Manager. This does not issue either. */
export function matchHayesDispositionReceipt(bytes:Uint8Array,expected:{receiptId:string;binding:unknown;nativeOwnerId:string;runtimeManifestSha256:string;workerManifestSha256:string;nativeEvidenceSha256:string;attestation:unknown;dbStageId:string;originalAssetId:string;displayAssetId:string;derivativeId:string;database:unknown;output:{sha256:string;bytes:number};receiptSha256:string}){
 const parsed=parseHayesDispositionReceipt(bytes),v=parsed.value;
 const a=v.attestation as {output:{sha256:string;bytes:number}};
 if(parsed.sha256!==expected.receiptSha256||v.receiptId!==expected.receiptId||!isDeepStrictEqual(v.binding,expected.binding)||v.nativeOwnerId!==expected.nativeOwnerId||v.runtimeManifestSha256!==expected.runtimeManifestSha256||v.workerManifestSha256!==expected.workerManifestSha256||v.nativeEvidenceSha256!==expected.nativeEvidenceSha256||!isDeepStrictEqual(v.attestation,expected.attestation)||v.dbStageId!==expected.dbStageId||v.originalAssetId!==expected.originalAssetId||v.displayAssetId!==expected.displayAssetId||v.derivativeId!==expected.derivativeId||!isDeepStrictEqual(v.database,expected.database)||a.output.sha256!==expected.output.sha256||a.output.bytes!==expected.output.bytes)throw Error('HAYES_RECEIPT_MISMATCH');
 return parsed;
}
