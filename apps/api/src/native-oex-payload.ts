// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,basename,isAbsolute,join} from 'node:path';

/** Pin and hash the actual packaged native manifest that Manager separately
 * admits. This correlates the packed-worker control to that manifest; it is
 * not code-signing, content admission, or permission to run a worker. */
export async function pinNativeOexPayloadManifest(path:string){
 if(typeof path!=='string'||!isAbsolute(path)||basename(path)!=='manifest.json')throw Error('NATIVE_OEX_PAYLOAD');
 const root=dirname(path),rootBefore=await lstat(root,{bigint:true});if(!rootBefore.isDirectory()||rootBefore.isSymbolicLink()||await realpath(root)!==root||join(root,'manifest.json')!==path)throw Error('NATIVE_OEX_PAYLOAD');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const baseline=await file.stat({bigint:true});if(!baseline.isFile()||baseline.nlink!==1n||baseline.size<1n||baseline.size>16777216n)throw Error('NATIVE_OEX_PAYLOAD');
  const same=(a:typeof baseline,b:typeof baseline)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.nlink===b.nlink;
  const verify=async()=>{const rootNow=await lstat(root,{bigint:true}),named=await lstat(path,{bigint:true}),current=await file.stat({bigint:true});if(!rootNow.isDirectory()||rootNow.isSymbolicLink()||rootNow.dev!==rootBefore.dev||rootNow.ino!==rootBefore.ino||await realpath(root)!==root||!named.isFile()||named.isSymbolicLink()||!same(baseline,named)||!same(baseline,current))throw Error('NATIVE_OEX_PAYLOAD');};
  await verify();const hash=createHash('sha256'),buffer=Buffer.alloc(65536),chunks:Buffer[]=[];let offset=0;
  while(BigInt(offset)<baseline.size){const length=Math.min(buffer.length,Number(baseline.size)-offset),part=await file.read(buffer,0,length,offset);if(part.bytesRead<1||part.bytesRead>length)throw Error('NATIVE_OEX_PAYLOAD');hash.update(buffer.subarray(0,part.bytesRead));chunks.push(Buffer.from(buffer.subarray(0,part.bytesRead)));offset+=part.bytesRead;}
  await verify();const digest=hash.digest('hex'),manifestBytes=Buffer.concat(chunks);let closed=false;
  const entries=()=>{if(closed)throw Error('NATIVE_OEX_PAYLOAD');let value:unknown;try{value=JSON.parse(manifestBytes.toString('utf8'));}catch{throw Error('NATIVE_OEX_PAYLOAD');}if(!value||typeof value!=='object'||!Array.isArray((value as {files?:unknown}).files))throw Error('NATIVE_OEX_PAYLOAD');return (value as {files:Array<{path?:unknown;sha256?:unknown;bytes?:unknown;executable?:unknown;link?:unknown}>}).files;};
  const hasPath=(path:string)=>entries().some(item=>item&&item.path===path);
  const hasRegular=(path:string)=>{const selected=entries().filter(item=>item&&item.path===path);return selected.length===1&&selected[0]!.link===undefined&&selected[0]!.executable===false&&typeof selected[0]!.bytes==='number'&&typeof selected[0]!.sha256==='string';};
  const hasExact=(path:string,sha256:string,bytes:number)=>{const selected=entries().filter(item=>item&&item.path===path);return selected.length===1&&selected[0]!.sha256===sha256&&selected[0]!.bytes===bytes&&selected[0]!.executable===false;};
  return Object.freeze({digest,hasPath,hasRegular,hasExact,verify:async()=>{if(closed)throw Error('NATIVE_OEX_PAYLOAD');await verify();},close:async()=>{if(!closed){closed=true;await file.close();}}});
 }catch(error){await file.close().catch(()=>{});throw error;}
}
