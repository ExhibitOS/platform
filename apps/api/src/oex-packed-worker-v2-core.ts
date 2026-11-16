// SPDX-License-Identifier: AGPL-3.0-or-later
import {isNativeOexFileManifest,isNativeOexFileFormat,type NativeOexFileFormat} from './oex-file-format.ts';
import {createHash} from 'node:crypto';
import {withOexFileHandle} from '@exhibitos/spec';
import {bindCurrentWorkspaceRailResource} from './oex-current-workspace-rail.ts';
import {writePackedCurrentWorkspaceRailOexAssets,writePackedOexAssets,writePackedWorkspaceOexAssets} from './oex-packed-writer.ts';

interface ReadHandle {stat(options:{bigint:true}):Promise<{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint;isFile():boolean}>;read(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesRead:number}>}
interface WriteHandle {write(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesWritten:number}>}
interface Entries {keys():IterableIterator<string>;get(path:string):Promise<Uint8Array|undefined>}
type OpenValidated=(file:ReadHandle,prepare:(input:{manifest:unknown;files:Entries})=>Promise<void>)=>Promise<void>;
type Receipt={archiveBytes:number;archiveSha256:string;capacity:number};
const hex=/^[a-f0-9]{64}$/,DOCUMENT_LIMIT=1024*1024;

/** V2 is a separate inactive worker core. The fixed Spec validator binds raw
 * manifest and scene to the archive; their returned hashes are not independent
 * authority. Manager must own/drain the worker and keep the input/output FDs,
 * live Session, fence and reservation through the actual consuming transaction. */
export async function preparePackedOexV2(input:ReadHandle,output:WriteHandle,receipt:Receipt,openValidated:OpenValidated,expectedFormat?:NativeOexFileFormat){
 if(expectedFormat!==undefined&&!isNativeOexFileFormat(expectedFormat))throw Error('OEX_PACKED_RECEIPT');
 return prepare(input,output,receipt,openValidated,writePackedOexAssets,manifest=>
  isNativeOexFileManifest(manifest)&&(expectedFormat===undefined||manifest.formatVersion===expectedFormat));
}
/** Draft.12 preparation remains inactive; caller retains the same owned FD,
 * Session, fence, capacity, actual drain and separate attachment obligations. */
export async function preparePackedWorkspaceOex(input:ReadHandle,output:WriteHandle,receipt:Receipt,openValidated:OpenValidated){
 return prepare(input,output,receipt,openValidated,writePackedWorkspaceOexAssets,manifest=>{
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return false;
  const value=manifest as Record<string,unknown>;
  return value.formatVersion==='1.0.0-draft.12'&&value.archiveProfile==='bounded-file-v1';
 });
}
/** Private .23 worker. Bind the scene resource before inspecting the model bytes. */
export async function preparePackedCurrentWorkspaceRailOex(input:ReadHandle,output:WriteHandle,receipt:Receipt){
 return prepare(input,output,receipt,(file,stage)=>withOexFileHandle(file,async archive=>{
  bindCurrentWorkspaceRailResource(archive.manifest,archive.exhibition);
  await stage(archive);
 }),writePackedCurrentWorkspaceRailOexAssets);
}
async function prepare(input:ReadHandle,output:WriteHandle,receipt:Receipt,openValidated:OpenValidated,writeAssets:typeof writePackedOexAssets,acceptsManifest?:(manifest:unknown)=>boolean){
 if(!receipt||Object.keys(receipt).sort().join(',')!=='archiveBytes,archiveSha256,capacity')throw Error('OEX_PACKED_RECEIPT');
 const values=['archiveBytes','archiveSha256','capacity'].map(key=>Object.getOwnPropertyDescriptor(receipt,key));if(values.some(v=>!v||!('value' in v)))throw Error('OEX_PACKED_RECEIPT');
 const r={archiveBytes:values[0]!.value as number,archiveSha256:values[1]!.value as string,capacity:values[2]!.value as number};
 if(!Number.isSafeInteger(r.archiveBytes)||r.archiveBytes<1||r.archiveBytes>512*1024*1024||!Number.isSafeInteger(r.capacity)||r.capacity<0||r.capacity>512*1024*1024||typeof r.archiveSha256!=='string'||!hex.test(r.archiveSha256))throw Error('OEX_PACKED_RECEIPT');
 const original=await input.stat({bigint:true});if(!original.isFile()||original.size!==BigInt(r.archiveBytes))throw Error('OEX_PACKED_INPUT');
 const check=async()=>{
  const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<r.archiveBytes){const limit=Math.min(buffer.length,r.archiveBytes-offset),n=await input.read(buffer,0,limit,offset);if(!Number.isSafeInteger(n.bytesRead)||n.bytesRead<1||n.bytesRead>limit)throw Error('OEX_PACKED_INPUT');h.update(buffer.subarray(0,n.bytesRead));offset+=n.bytesRead;}
  const after=await input.stat({bigint:true});if(after.dev!==original.dev||after.ino!==original.ino||after.size!==original.size||after.mtimeNs!==original.mtimeNs||after.ctimeNs!==original.ctimeNs||h.digest('hex')!==r.archiveSha256)throw Error('OEX_PACKED_INPUT');
 };
 await check();let result:{manifest:Buffer;exhibition:Buffer;entries:Awaited<ReturnType<typeof writePackedOexAssets>>}|undefined;
 await openValidated(input,async({manifest,files})=>{
  if(result)throw Error('OEX_PACKED_OUTPUT');
  if(acceptsManifest&&!acceptsManifest(manifest))throw Error('OEX_PACKED_DOCUMENT');
  const m=await files.get('manifest.json'),e=await files.get('exhibition.json');
  if(!m||!e||m.byteLength<1||e.byteLength<1||m.byteLength>DOCUMENT_LIMIT||e.byteLength>DOCUMENT_LIMIT)throw Error('OEX_PACKED_DOCUMENT');
  const manifestBytes=Buffer.from(m),exhibitionBytes=Buffer.from(e),entries=await writeAssets(output,manifest,files,r.capacity);
  result={manifest:manifestBytes,exhibition:exhibitionBytes,entries};
 });
 if(!result)throw Error('OEX_PACKED_OUTPUT');await check();
 return {...result,manifestSha256:createHash('sha256').update(result.manifest).digest('hex'),exhibitionSha256:createHash('sha256').update(result.exhibition).digest('hex')};
}
