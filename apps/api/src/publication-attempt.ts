// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrow publication-owned journal, independent of the parent SQL transaction.
import {constants} from 'node:fs';
import {open,realpath,lstat,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {sha256,transaction,FileBlobStore} from '@exhibitos/storage';
import type {DiskOwner} from './publication-disk-budget.ts';

interface OwnedObject {key:string;sha256:string;bytes:number}
export interface PublicationAttempt {
 version:1;attemptId:string;generation:string;owner:DiskOwner;runtimeGeneration?:string;
 tenantId:string;userId:string;requestId:string;exhibitionId:string;
 etag:string;payloadHash:string;publicationId:string;snapshotHash:string;
 objects:OwnedObject[];
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[0-9a-f]{64}$/;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const LIMIT=262144;
const filePrototype=FileBlobStore.prototype;
const fileMethods=new Map(Object.getOwnPropertyNames(filePrototype).map(name=>[name,Object.getOwnPropertyDescriptor(filePrototype,name)?.value as unknown]));
/** Recovery/admission only support the actual unwrapped immutable local store,
 * including its private path checks; subclasses/instance overrides fail closed. */
export function isPublicationFileStore(value:unknown):value is FileBlobStore{
 const root=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'root'):undefined;
 return !!root&&Object.hasOwn(root,'value')&&typeof root.value==='string'&&value instanceof FileBlobStore&&Object.getPrototypeOf(value)===filePrototype&&Object.getOwnPropertyNames(value).every(name=>name==='root')&&Object.getOwnPropertyNames(filePrototype).length===fileMethods.size&&[...fileMethods].every(([name,method])=>Object.getOwnPropertyDescriptor(filePrototype,name)?.value===method);
}
/** Pin the stock store's declared readonly root before any asynchronous identity
 * check. Methods have no mutable instance state. This also prevents an instance
 * method being shadowed during an awaited read/delete/write. */
export function pinPublicationFileStore(value:unknown):FileBlobStore{
 if(!isPublicationFileStore(value))throw Error('PUBLICATION_ATTEMPT_OWNER');
 Object.freeze(value);return value;
}
function validate(a:PublicationAttempt){
 if(!a||Object.keys(a).filter(k=>k!=='runtimeGeneration').sort().join(',')!=='attemptId,etag,exhibitionId,generation,objects,owner,payloadHash,publicationId,requestId,snapshotHash,tenantId,userId,version'||a.version!==1||![a.attemptId,a.generation,a.tenantId,a.userId,a.requestId,a.exhibitionId,a.publicationId].every(v=>typeof v==='string'&&uuid.test(v))||Object.hasOwn(a,'runtimeGeneration')&&(typeof a.runtimeGeneration!=='string'||!uuid.test(a.runtimeGeneration))||typeof a.etag!=='string'||!/^"studio-r[1-9][0-9]*-[0-9a-f]{64}"$/.test(a.etag)||!hash.test(a.payloadHash)||!hash.test(a.snapshotHash)||!a.owner||Object.keys(a.owner).sort().join(',')!=='databaseOid,databaseSystemId,storeDevice,storeInode,storeRoot'||![a.owner.databaseOid,a.owner.databaseSystemId,a.owner.storeDevice,a.owner.storeInode].every(v=>typeof v==='string'&&/^[0-9]{1,24}$/.test(v))||!isAbsolute(a.owner.storeRoot)||!Array.isArray(a.objects)||a.objects.length>256)throw Error('PUBLICATION_ATTEMPT_INVALID');
 const keys=new Set<string>();let total=0;
 for(const o of a.objects){
  if(!o||Object.keys(o).sort().join(',')!=='bytes,key,sha256'||!hash.test(o.sha256)||!Number.isSafeInteger(o.bytes)||o.bytes<1||o.bytes>33554432||typeof o.key!=='string')throw Error('PUBLICATION_ATTEMPT_INVALID');
  const parts=o.key.split('/');if(parts.length!==5||parts[0]!==a.tenantId||parts[1]!=='publications'||parts[2]!==a.publicationId||!uuid.test(parts[3]??'')||parts[4]!==o.sha256||keys.has(o.key))throw Error('PUBLICATION_ATTEMPT_INVALID');
  keys.add(o.key);total+=o.bytes;
 }
 if(total>536870912)throw Error('PUBLICATION_ATTEMPT_INVALID');
}
async function privateRoot(root:string){const s=await lstat(root);if(!isAbsolute(root)||await realpath(root)!==root||!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw Error('PUBLICATION_ATTEMPT_ROOT');}
async function syncDir(root:string){const f=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
/** Live identity is read through the actual transaction connection. Lack of
 * permission to identify the physical database disables this optional path. */
export async function publicationDiskOwner(c:PoolClient,storeRoot:string):Promise<DiskOwner>{
 if(!isAbsolute(storeRoot)||await realpath(storeRoot)!==storeRoot)throw Error('PUBLICATION_ATTEMPT_OWNER');
 const s=await stat(storeRoot,{bigint:true});if(!s.isDirectory())throw Error('PUBLICATION_ATTEMPT_OWNER');
 const r=(await c.query('SELECT system_identifier::text AS system_id,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid FROM pg_control_system()')).rows[0];
 return {databaseSystemId:r.system_id,databaseOid:r.database_oid,storeRoot,storeDevice:String(s.dev),storeInode:String(s.ino)};
}
export class PublicationAttempts {
 private readonly root:string;
 constructor(root:string){this.root=root;}
 /** Called while the publishing transaction holds 82003→82002, before the
  * first final put. Partial/uncertain records are retained, never adopted. */
 async create(input:PublicationAttempt){
  const a=JSON.parse(canonical(input)) as PublicationAttempt;validate(a);const text=canonical(a);if(Buffer.byteLength(text)>LIMIT)throw Error('PUBLICATION_ATTEMPT_INVALID');
  await privateRoot(this.root);const f=await open(join(this.root,a.attemptId+'.json'),'wx',0o600);
  try{await f.writeFile(text);await f.sync();}finally{await f.close();}await syncDir(this.root);
 }
 async read(id:string):Promise<PublicationAttempt>{
  if(!uuid.test(id))throw Error('PUBLICATION_ATTEMPT_INVALID');await privateRoot(this.root);
  const f=await open(join(this.root,id+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const s=await f.stat({bigint:true});if(!s.isFile()||s.nlink!==1n||s.size>BigInt(LIMIT)||(s.mode&0o077n)!==0n||s.uid!==BigInt(process.getuid?.()??-1))throw Error('PUBLICATION_ATTEMPT_INVALID');
   const bytes=Buffer.alloc(LIMIT+1);let n=0;while(n<bytes.length){const r=await f.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
   const after=await f.stat({bigint:true});if(BigInt(n)!==s.size||s.size!==after.size||s.mtimeNs!==after.mtimeNs||s.ctimeNs!==after.ctimeNs)throw Error('PUBLICATION_ATTEMPT_INVALID');
   const a=JSON.parse(bytes.subarray(0,n).toString('utf8')) as PublicationAttempt;validate(a);if(a.attemptId!==id)throw Error('PUBLICATION_ATTEMPT_INVALID');return a;
  }finally{await f.close();}
 }
 /** Own a separate transaction, distinct from the active publisher. The caller
  * must first prove this generation permanently
  * cannot write/respawn and that all actual writers drained. A dead DB session
  * alone is NOT that proof. This method never releases the disk reservation. */
 async recover(pool:Pool,blobs:FileBlobStore,id:string,generation:string,verifyDrain:(a:PublicationAttempt)=>Promise<boolean>){
  const a=await this.read(id);
  // The verifier never receives the private validated snapshot subsequently
  // used for DB lookups/deletion, even across an awaited callback.
  if(a.generation!==generation||!await verifyDrain(JSON.parse(canonical(a)) as PublicationAttempt))throw Error('PUBLICATION_ATTEMPT_DRAIN_UNCONFIRMED');
  pinPublicationFileStore(blobs);
  if(await realpath(blobs.root)!==a.owner.storeRoot)throw Error('PUBLICATION_ATTEMPT_OWNER');
  return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  if(canonical(await publicationDiskOwner(c,a.owner.storeRoot))!==canonical(a.owner))throw Error('PUBLICATION_ATTEMPT_OWNER');
  // Exact PK lookups and publication-scoped bindings; no global reference scan.
  const p=(await c.query('SELECT tenant_id,exhibition_id,created_by,revision_sha256 FROM studio_publications WHERE id=$1',[a.publicationId])).rows[0];
  const r=(await c.query('SELECT payload_sha256,publication_id FROM publication_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[a.tenantId,a.userId,a.requestId])).rows[0];
  const objects=(await c.query('SELECT object_key,sha256,bytes FROM publication_assets WHERE publication_id=$1 UNION ALL SELECT object_key,sha256,bytes FROM publication_media WHERE publication_id=$1 UNION ALL SELECT object_key,sha256,bytes FROM publication_cover_images WHERE publication_id=$1',[a.publicationId])).rows.map(o=>({key:o.object_key,sha256:o.sha256,bytes:Number(o.bytes)}));
  if(p||r||objects.length){
   if(!p||!r||p.tenant_id!==a.tenantId||p.exhibition_id!==a.exhibitionId||p.created_by!==a.userId||p.revision_sha256!==a.snapshotHash||r.payload_sha256!==a.payloadHash||r.publication_id!==a.publicationId||canonical(objects.sort((x,y)=>x.key.localeCompare(y.key)))!==canonical([...a.objects].sort((x,y)=>x.key.localeCompare(y.key))))throw Error('PUBLICATION_ATTEMPT_UNCERTAIN');
   return {outcome:'committed' as const,removed:0};
  }
  // First verify every extant exact owned key. Any mismatch preserves all keys.
  const present:string[]=[];
  for(const o of a.objects){try{const bytes=await blobs.get(o.key);if(bytes.length!==o.bytes||sha256(bytes)!==o.sha256)throw Error('PUBLICATION_ATTEMPT_UNCERTAIN');present.push(o.key);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  for(const key of present)await blobs.remove(key);
  // Keep the immutable manifest as evidence. Repeated recovery sees ENOENT;
  // unknown prefixes, originals and unrelated objects are never enumerated.
  return {outcome:'rolled-back' as const,removed:present.length};
  });
 }
}
