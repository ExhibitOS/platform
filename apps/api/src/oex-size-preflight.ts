// SPDX-License-Identifier: AGPL-3.0-or-later
import {isNativeOexFileManifest} from './oex-file-format.ts';
import {createHash} from 'node:crypto';
import {withOexFileHandle,type OexReadHandle} from '@exhibitos/spec';
import {decodePackedOexDocumentsV2,decodePackedWorkspaceOexDocuments} from './oex-packed-documents-v2.ts';
import {packedOexInventory,packedWorkspaceOexInventory} from './oex-packed-output.ts';
import type {NativeOexFileFormat} from './oex-file-format.ts';

const MAX=512*1024*1024;
const hex=/^[a-f0-9]{64}$/;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const same=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

/** Read-only bounded draft.9/10 sizing evidence, never reservation or commit authority.
 * The Spec reader validates assets (including GLB) in-process; product use
 * requires an owned, bounded, cancellable and actually drained worker. This
 * does not replace the product decoder. Caller retains a stable input FD;
 * resource ownership, sealing, budget and actual output checks are separate. */
type Evidence<F extends string>={archiveFormat:F;archiveBytes:number;expandedBytes:number;packedBytes:number;manifestSha256:string;entryCount:number;archiveSha256:string;inputDevice:string;inputInode:string};
export function preflightOexSize(file:OexReadHandle,expected:{bytes:number;sha256:string}){
 return preflight(file,expected,false) as Promise<Readonly<Evidence<NativeOexFileFormat>>>;
}
/** Separate, inactive bounded draft.12 sizing; it grants no reservation,
 * owner authority, output integrity or worker-drain proof. */
export function preflightWorkspaceOexSize(file:OexReadHandle,expected:{bytes:number;sha256:string}){
 return preflight(file,expected,true) as Promise<Readonly<Evidence<'1.0.0-draft.12'>>>;
}
async function preflight(file:OexReadHandle,expected:{bytes:number;sha256:string},workspace:boolean){
 const bytes=expected?.bytes,sha256=expected?.sha256;
 if(!file||!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX||typeof sha256!=='string'||!hex.test(sha256))throw Error('OEX_PREFLIGHT_INPUT');
 const initial=await file.stat({bigint:true});
 if(!initial.isFile()||initial.size!==BigInt(bytes))throw Error('OEX_PREFLIGHT_INPUT');
 const hashInput=async()=>{
  const before=await file.stat({bigint:true});if(!same(initial,before))throw Error('OEX_PREFLIGHT_CHANGED');
  const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<bytes){const length=Math.min(buffer.length,bytes-offset),r=await file.read(buffer,0,length,offset);if(!Number.isSafeInteger(r.bytesRead)||r.bytesRead<1||r.bytesRead>length)throw Error('OEX_PREFLIGHT_CHANGED');h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
  if(!same(initial,await file.stat({bigint:true})))throw Error('OEX_PREFLIGHT_CHANGED');
  return h.digest('hex');
 };
 if(await hashInput()!==sha256)throw Error('OEX_PREFLIGHT_HASH');
 const value=await withOexFileHandle(file,async({manifest,files})=>{
  // The installed Spec runtime exposes these counters; its public type omits
  // them, so fail closed if a different runtime does not provide safe values.
  const indexed=files as typeof files & {archiveBytes?:unknown;expandedBytes?:unknown};
  if(typeof indexed.archiveBytes!=='number'||typeof indexed.expandedBytes!=='number'||!Number.isSafeInteger(indexed.archiveBytes)||!Number.isSafeInteger(indexed.expandedBytes)||indexed.expandedBytes<0)throw Error('OEX_PREFLIGHT_LIMIT');
  const manifestBytes=await files.get('manifest.json'),exhibitionBytes=await files.get('exhibition.json');
  if(!manifestBytes||!exhibitionBytes)throw Error('OEX_PREFLIGHT_DOCUMENT');
  const manifestSha256=digest(manifestBytes),decoded=(workspace?decodePackedWorkspaceOexDocuments:decodePackedOexDocumentsV2)(manifestBytes,manifestSha256,exhibitionBytes,digest(exhibitionBytes));
  const inventory=(workspace?packedWorkspaceOexInventory:packedOexInventory)(decoded.manifest);let packedBytes=0;
  for(const item of inventory.values()){packedBytes+=item.bytes;if(!Number.isSafeInteger(packedBytes)||packedBytes>MAX)throw Error('OEX_PREFLIGHT_LIMIT');}
  if(packedBytes>indexed.expandedBytes||indexed.archiveBytes!==bytes||(workspace?(manifest.formatVersion!=='1.0.0-draft.12'||manifest.archiveProfile!=='bounded-file-v1'):!isNativeOexFileManifest(manifest)))throw Error('OEX_PREFLIGHT_LIMIT');
  return {archiveFormat:manifest.formatVersion,archiveBytes:indexed.archiveBytes,expandedBytes:indexed.expandedBytes,packedBytes,manifestSha256,entryCount:files.size};
 });
 if(await hashInput()!==sha256)throw Error('OEX_PREFLIGHT_HASH');
 return Object.freeze({...value,archiveSha256:sha256,inputDevice:initial.dev.toString(),inputInode:initial.ino.toString()});
}
