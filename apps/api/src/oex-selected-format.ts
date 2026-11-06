// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {fstatSync,readSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withOexSizeIndex,validateOexManifest,type OexReadHandle} from '@exhibitos/spec';
import {isNativeOexFileManifest,type NativeOexFileFormat} from './oex-file-format.ts';
/** Provisional selected-file metadata only. This does not validate artwork,
 * hash the archive, reserve capacity, authorize import or settle a worker.
 * The owner must correlate this same FD/selected hash with full preflight. */
type Hint<F extends string>={version:1;kind:'oex-format-hint';archiveFormat:F;archiveBytes:number;manifestSha256:string;inputDevice:string;inputInode:string};
export function selectedOexFormat(file:OexReadHandle){
 return select(file,false) as Promise<Readonly<Hint<NativeOexFileFormat>>>;
}
/** Separate inactive workspace format hint. This is not authority. */
export function selectedWorkspaceOexFormat(file:OexReadHandle){
 return select(file,true) as Promise<Readonly<Hint<'1.0.0-draft.12'>>>;
}
async function select(file:OexReadHandle,workspace:boolean){
 const before=await file.stat({bigint:true});
 if(!before.isFile()||before.size<1n||before.size>536870912n)throw Error('OEX_FORMAT_HINT');
 return withOexSizeIndex(file,async index=>{
  if(index.archiveBytes!==Number(before.size)||index.manifestBytes.byteLength>1048576)throw Error('OEX_FORMAT_HINT');
  let manifest:unknown;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(index.manifestBytes));}catch{throw Error('OEX_FORMAT_HINT');}
  const selected=workspace&&!!manifest&&typeof manifest==='object'&&!Array.isArray(manifest)&&(manifest as Record<string,unknown>).formatVersion==='1.0.0-draft.12'&&(manifest as Record<string,unknown>).archiveProfile==='bounded-file-v1';
  if(!(workspace?selected:isNativeOexFileManifest(manifest))||!validateOexManifest(manifest).valid)throw Error('OEX_FORMAT_HINT');
  const after=await file.stat({bigint:true});
  if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('OEX_FORMAT_HINT');
  return Object.freeze({version:1,kind:'oex-format-hint',archiveFormat:(manifest as {formatVersion:string}).formatVersion,archiveBytes:index.archiveBytes,manifestSha256:createHash('sha256').update(index.manifestBytes).digest('hex'),inputDevice:String(before.dev),inputInode:String(before.ino)});
 });
}
export async function runOexFormatHint(workspace=false){
 try{
  const text=process.env.EXHIBITOS_OEX_FORMAT_FD;if(!text||!/^([1-9][0-9]{1,3})$/.test(text)||Number(text)<64||Number(text)>1023)throw Error('OEX_FORMAT_HINT');
  const fd=Number(text);
  try{const hint=await (workspace?selectedWorkspaceOexFormat:selectedOexFormat)({stat:async()=>fstatSync(fd,{bigint:true}),read:async(buffer,offset,length,position)=>({bytesRead:readSync(fd,buffer,offset,length,position)})});process.stdout.write(JSON.stringify(hint)+'\n');}finally{closeSync(fd);}
 }catch{process.exitCode=1;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runOexFormatHint();
