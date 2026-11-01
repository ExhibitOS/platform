// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {FileHandle} from 'node:fs/promises';

const MAX_TOTAL=512*1024*1024,MAX_ENTRY=32*1024*1024,MAX_ENTRIES=254;
const hex=/^[a-f0-9]{64}$/;
type Entry={path:string;offset:number;bytes:number;sha256:string};
type StatIdentity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const same=(a:StatIdentity,b:StatIdentity)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

/** Call only with a separately validated and receipt-bound Spec manifest. */
export function packedOexInventory(trustedManifest:unknown){
 if(!trustedManifest||typeof trustedManifest!=='object'||Array.isArray(trustedManifest))throw Error('OEX_PACKED_OUTPUT');
 const trusted=trustedManifest as Record<string,unknown>;if(trusted.formatVersion!=='1.0.0-draft.9')throw Error('OEX_PACKED_OUTPUT');
 const inventory:unknown[]=[];
 for(const key of ['assets','floorResources','furnishingNotices','materialResources','footstepResources']){
  const part=trusted[key];if(part!==undefined&&!Array.isArray(part))throw Error('OEX_PACKED_OUTPUT');if(Array.isArray(part)){if(part.length>MAX_ENTRIES-inventory.length)throw Error('OEX_PACKED_OUTPUT');for(const entry of part)inventory.push(entry);}
 }
 const expected=new Map<string,{bytes:number;sha256:string}>();
 for(const item of inventory){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('OEX_PACKED_OUTPUT');
  const entry=item as {path?:unknown;bytes?:unknown;sha256?:unknown};
  if(typeof entry.path!=='string'||!entry.path||entry.path.length>1024||expected.has(entry.path)||!Number.isSafeInteger(entry.bytes)||Number(entry.bytes)<1||Number(entry.bytes)>MAX_ENTRY||typeof entry.sha256!=='string'||!hex.test(entry.sha256))throw Error('OEX_PACKED_OUTPUT');
  expected.set(entry.path,{bytes:Number(entry.bytes),sha256:entry.sha256});
 }
 return expected;
}

/** Inactive packed-FD consumer. The caller must use a trusted, revalidated
 * OEX manifest and a Manager-owned, sealed, synced and fully drained file
 * handle. This function cannot prove process drain or reservation authority;
 * the owner must limit simultaneous bindings across the operation. */
export async function bindPackedOexOutputs(file:FileHandle,reply:Uint8Array,trustedManifest:unknown,capacity:number){
 if(!Number.isSafeInteger(capacity)||capacity<0||capacity>MAX_TOTAL)throw Error('OEX_PACKED_OUTPUT');
 if(!(reply instanceof Uint8Array)||reply.byteLength<1||reply.byteLength>4*1024*1024)throw Error('OEX_PACKED_OUTPUT');
 let snapshot:unknown;try{snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reply));}catch{throw Error('OEX_PACKED_OUTPUT');}
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw Error('OEX_PACKED_OUTPUT');
 const result=snapshot as {version?:unknown;kind?:unknown;status?:unknown;entries?:unknown};
 if(result.version!==1||result.kind!=='prepared'||result.status!=='complete'||!Array.isArray(result.entries))throw Error('OEX_PACKED_OUTPUT');
 const expected=packedOexInventory(trustedManifest);
 if(expected.size!==result.entries.length)throw Error('OEX_PACKED_OUTPUT');
 const entries=new Map<string,Readonly<Entry>>();
 for(const item of result.entries){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='bytes,offset,path,sha256')throw Error('OEX_PACKED_OUTPUT');
  const entry=item as Entry,match=expected.get(entry.path);
  if(entries.has(entry.path)||!match||entry.bytes!==match.bytes||entry.sha256!==match.sha256||!Number.isSafeInteger(entry.offset)||entry.offset<0||entry.offset>capacity-entry.bytes)throw Error('OEX_PACKED_OUTPUT');
  entries.set(entry.path,Object.freeze({...entry}));
 }
 let total=0;for(const entry of [...entries.values()].sort((a,b)=>a.offset-b.offset)){if(entry.offset!==total)throw Error('OEX_PACKED_OUTPUT');total+=entry.bytes;}
 if(total>capacity)throw Error('OEX_PACKED_OUTPUT');
 const baseline=await file.stat({bigint:true});
 if(!baseline.isFile()||baseline.nlink>1n||baseline.size!==BigInt(total)||(baseline.mode&0o077n)!==0n||baseline.uid!==BigInt(process.getuid?.()??-1))throw Error('OEX_PACKED_OUTPUT');
 let reading=false;
 const read=async(entry:Readonly<Entry>)=>{
  if(reading)throw Error('OEX_PACKED_BUSY');reading=true;
  try{
  const before=await file.stat({bigint:true});if(!same(baseline,before))throw Error('OEX_PACKED_OUTPUT');
  const bytes=Buffer.alloc(entry.bytes);let readBytes=0;
  while(readBytes<bytes.length){const next=await file.read(bytes,readBytes,bytes.length-readBytes,entry.offset+readBytes);if(!next.bytesRead)throw Error('OEX_PACKED_OUTPUT');readBytes+=next.bytesRead;}
  const after=await file.stat({bigint:true});if(!same(baseline,after)||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('OEX_PACKED_OUTPUT');return bytes;
  }finally{reading=false;}
 };
 for(const entry of entries.values())await read(entry);
 return Object.freeze({read:async(path:string)=>{const entry=entries.get(path);if(!entry)throw Error('OEX_PACKED_OUTPUT');return read(entry);}});
}
