// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const keys=['version','kind','binding','nativeOwnerId','runtimeManifestSha256','workerManifestSha256','nativeEvidenceSha256','readyFrameSha256','dbStageId','database','challenge','receiptId','receiptSha256','intentSha256','completionSha256'];
type Expected={binding:HayesOperationBinding;nativeOwnerId:string;runtimeManifestSha256:string;workerManifestSha256:string;nativeEvidenceSha256:string;readyFrameSha256:string;dbStageId:string;database:{systemIdentifier:string;databaseOid:string};challenge:string;receiptId:string;receiptSha256:string};
/** Data-only parser. Only an authenticated live same-session receiver may
 * establish that this frame follows Manager's verified resource return. */
export function decodeHayesReleaseCompletion(raw:Uint8Array,expected:Expected){
 try{
  if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error();
  const bytes=Buffer.from(raw),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);
  if(!Buffer.from(text).equals(bytes)||!value||typeof value!=='object'||Array.isArray(value))throw Error();
  const v=value as Record<string,unknown>,binding=parseHayesOperationBinding(v.binding);
  if(JSON.stringify(Object.keys(v))!==JSON.stringify(keys)||JSON.stringify(v)!==text||v.version!==1||v.kind!=='hayes-release-completed'||JSON.stringify(v.binding)!==JSON.stringify(binding)||!isDeepStrictEqual(binding,expected.binding))throw Error();
  for(const key of ['nativeOwnerId','dbStageId','challenge','receiptId'] as const)if(typeof v[key]!=='string'||!uuid.test(v[key])||v[key]!==expected[key])throw Error();
  for(const key of ['runtimeManifestSha256','workerManifestSha256','nativeEvidenceSha256','readyFrameSha256','receiptSha256'] as const)if(typeof v[key]!=='string'||!hash.test(v[key])||v[key]!==expected[key])throw Error();
  for(const key of ['intentSha256','completionSha256'] as const)if(typeof v[key]!=='string'||!hash.test(v[key]))throw Error();
  if(!v.database||typeof v.database!=='object'||Array.isArray(v.database)||JSON.stringify(Object.keys(v.database))!==JSON.stringify(['systemIdentifier','databaseOid'])||!isDeepStrictEqual(v.database,expected.database))throw Error();
  return Object.freeze({binding,nativeOwnerId:expected.nativeOwnerId,runtimeManifestSha256:expected.runtimeManifestSha256,workerManifestSha256:expected.workerManifestSha256,nativeEvidenceSha256:expected.nativeEvidenceSha256,readyFrameSha256:expected.readyFrameSha256,dbStageId:expected.dbStageId,database:Object.freeze({...expected.database}),challenge:expected.challenge,receiptId:expected.receiptId,receiptSha256:expected.receiptSha256,intentSha256:v.intentSha256 as string,completionSha256:v.completionSha256 as string,canonical:bytes});
 }catch{throw Error('HAYES_RELEASE_COMPLETION_INVALID');}
}
