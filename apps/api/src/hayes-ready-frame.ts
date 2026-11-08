// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {parseHayesDispositionReceipt} from './hayes-disposition-receipt.ts';

const fields=['version','kind','binding','nativeOwnerId','runtimeManifestSha256','workerManifestSha256','nativeEvidenceSha256','attestation','database'];
const placeholder=(n:string)=>`00000000-0000-4000-8000-${n.padStart(12,'0')}`;
// This exact selected adapter is bound to the separately sealed worker image.
// A future multi-package capability needs independently admitted bootstrap.
const selectedWorkerManifest='94a6551d16af3fb134f94549d9f087ee8ccb9fd2372d914de5f738a78d3505c6';
/** Decode and compare data only. This does not authenticate a sender, admit a
 * containment producer, establish worker drain, or issue a ready capability. */
export function decodeHayesReadyFrame(raw:Uint8Array,expected:{binding:unknown;nativeOwnerId:string;runtimeManifestSha256:string;database:unknown}){
 try{
  if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error();
  const bytes=Buffer.from(raw),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),v:unknown=JSON.parse(text);
  if(!Buffer.from(text).equals(bytes)||!v||typeof v!=='object'||Array.isArray(v)||JSON.stringify(Object.keys(v))!==JSON.stringify(fields)||JSON.stringify(v)!==text)throw Error();
  const value=v as Record<string,unknown>;
  if(value.version!==1||value.kind!=='hayes-output-ready'||value.nativeOwnerId!==expected.nativeOwnerId||value.runtimeManifestSha256!==expected.runtimeManifestSha256||value.workerManifestSha256!==selectedWorkerManifest||!isDeepStrictEqual(value.binding,expected.binding)||!isDeepStrictEqual(value.database,expected.database))throw Error();
  // Reuse the exact independently agreed nested shape and canonical decimal
  // rules. Placeholder IDs are local parser inputs, not asset records.
  const receipt={version:1,outcome:'committed',receiptId:placeholder('1'),binding:value.binding,nativeOwnerId:value.nativeOwnerId,runtimeManifestSha256:value.runtimeManifestSha256,workerManifestSha256:value.workerManifestSha256,nativeEvidenceSha256:value.nativeEvidenceSha256,attestation:value.attestation,dbStageId:placeholder('2'),originalAssetId:placeholder('3'),displayAssetId:placeholder('4'),derivativeId:placeholder('5'),database:value.database};
  parseHayesDispositionReceipt(Buffer.from(JSON.stringify(receipt)));
  const a=value.attestation as {containment:{kind:string};source:{stageId:string;device:string;inode:string};output:{stageId:string;device:string;inode:string;sha256:string;bytes:number}};
  if(a.containment.kind!=='darwin-fixed-hayes-leaves-v1'||a.output.sha256!=='694a9cf81dfbf12fd0841ae45240c5ae0f1d7cb129d0ee122be7cff86c4625bc'||a.output.bytes!==16036864||a.source.stageId===a.output.stageId||a.source.device===a.output.device&&a.source.inode===a.output.inode)throw Error();
  return value;
 }catch{throw Error('HAYES_READY_FRAME_INVALID');}
}
