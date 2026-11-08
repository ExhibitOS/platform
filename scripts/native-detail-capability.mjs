// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';

export const NATIVE_DETAIL_CAPABILITY='{"format":1,"kind":"exhibitos-native-detail-static-export","protocol":"native-detail-v1","startupFrameVersion":1,"settlementVersion":1,"commit":"descriptor-relative-no-replace"}';
// These producer and transport entrypoints must be present in the pinned
// payload before the optional detail context may be issued. Full manifest
// verification and JPEG dependency inventory remain separate requirements.
export const NATIVE_DETAIL_REQUIRED_PATHS=Object.freeze([
 'platform/apps/api/dist/native-detail-static-export.js','platform/apps/api/dist/native-detail-http.js','platform/apps/api/dist/native-detail-context.js','platform/apps/api/dist/native-detail-drain.js',
 'platform/apps/api/dist/native-original-publication.js','platform/apps/api/dist/native-original-export-plan.js','platform/apps/api/dist/native-original-image-model.js','platform/apps/api/dist/original-detail-binding.js','platform/apps/api/dist/artwork-original-static-approval.js','platform/apps/api/dist/detail-source-commitment.js',
 'platform/apps/api/dist/jpeg-baseline-structure.js','platform/apps/api/dist/jpeg-inspection-client.js','platform/apps/api/dist/jpeg-inspection-worker.js','platform/apps/api/dist/native-local-publication-stage.js','platform/apps/api/dist/publication.js','platform/apps/api/dist/routes.js',
 'platform/scripts/native-static-export.mjs','platform/scripts/export-static-publication.mjs','platform/scripts/native-detail-plan.mjs','platform/scripts/native-detail-pipe.mjs','platform/scripts/native-detail-control.mjs','platform/scripts/native-detail-export-runner.mjs','platform/apps/web/src/static-json.mjs',
]);
export function hasNativeDetailRequiredFiles(payload){return !!payload&&typeof payload.hasRegular==='function'&&NATIVE_DETAIL_REQUIRED_PATHS.every(path=>payload.hasRegular(path));}
/** Marker admission is only protocol compatibility, never source authority. */
export async function hasNativeDetailCapability(path){
 let file;try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=await file.stat({bigint:true}),expected=Buffer.from(NATIVE_DETAIL_CAPABILITY),buffer=Buffer.alloc(expected.length+1);
  if(!before.isFile()||before.nlink!==1n||before.size!==BigInt(expected.length)||(before.mode&0o111n)!==0n)return false;
  let offset=0;while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  const after=await file.stat({bigint:true});
  return offset===expected.length&&buffer.subarray(0,offset).equals(expected)&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&before.mode===after.mode&&before.nlink===after.nlink;
 }catch{return false;}finally{await file?.close();}
}
