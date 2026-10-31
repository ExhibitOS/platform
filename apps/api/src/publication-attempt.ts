// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrow publication-owned journal, independent of the parent SQL transaction.
import {constants} from 'node:fs';
import {open,realpath,lstat,stat,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {sha256,transaction,FileBlobStore} from '@exhibitos/storage';
import {PublicationDiskBudget,diskReservationReceiptDigest,type DiskOwner,type DiskPlan,type DiskReservationBinding,type DiskReservationReceipt,type DiskClaimJournalBinding} from './publication-disk-budget.ts';

interface OwnedObject {key:string;sha256:string;bytes:number}
export interface PublicationAttempt {
 version:1;attemptId:string;generation:string;owner:DiskOwner;runtimeGeneration?:string;
 tenantId:string;userId:string;requestId:string;exhibitionId:string;
 etag:string;payloadHash:string;publicationId:string;snapshotHash:string;
 objects:OwnedObject[];
}
export interface ResourceClaimRequest {
 operation:DiskReservationBinding['operation'];purpose:'readiness'|'publish'|'import'|'export'|'freeze';
 tenantId:string;resourceId:string;attemptId:string;generation:string;runtimeGeneration:string;
 userId:string;requestId:string;requestDigest:string;sourceDigest:string;stageId:string;
 reservationId:string;owner:DiskOwner;plan:DiskPlan[];
}
export interface ResourceClaimRecord extends ResourceClaimRequest {
 version:1;kind:'resource-claim';journal:DiskClaimJournalBinding;coordinator:DiskClaimJournalBinding;
}
export interface ResourceClaimHandle {readonly digest:string}
export interface ResourceReservationRecord {
 version:1;kind:'resource-reservation';claimDigest:string;receipt:DiskReservationReceipt;
 receiptDigest:string;managerBindingDigest:string;
}
interface ClaimState {record:ResourceClaimRecord;text:string;anchor:string;alias:string;device:bigint;inode:bigint;binding?:{text:string;anchor:string;alias:string;device:bigint;inode:bigint}}
const issuedClaims=new WeakMap<ResourceClaimHandle,ClaimState>();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[0-9a-f]{64}$/;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const LIMIT=262144;
function claimSnapshot<T>(input:T):T{
 let nodes=0;
 const copy=(v:unknown,depth:number):unknown=>{
  if(++nodes>2048||depth>12)throw Error('PUBLICATION_CLAIM_INVALID');
  if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||![Object.prototype,Array.prototype,null].includes(Object.getPrototypeOf(v) as object|null))throw Error('PUBLICATION_CLAIM_INVALID');
  const array=Array.isArray(v),result=array?[]:Object.create(null) as {[key:string]:unknown};
  const keys=Reflect.ownKeys(v);
  if(array&&keys.length!==v.length+1)throw Error('PUBLICATION_CLAIM_INVALID');
  if(array)for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,String(i)))throw Error('PUBLICATION_CLAIM_INVALID');
  for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('PUBLICATION_CLAIM_INVALID');Object.defineProperty(result,key,{value:copy(d.value,depth+1),enumerable:true});}
  return Object.freeze(result);
 };
 const result=copy(input,0) as T;if(Buffer.byteLength(canonical(result))>LIMIT)throw Error('PUBLICATION_CLAIM_INVALID');return result;
}
function claimKeys(v:unknown,keys:string){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys)throw Error('PUBLICATION_CLAIM_INVALID');}
function validateClaimRequest(r:ResourceClaimRequest){
 claimKeys(r,'attemptId,generation,operation,owner,plan,purpose,requestDigest,requestId,reservationId,resourceId,runtimeGeneration,sourceDigest,stageId,tenantId,userId');
 if(![r.tenantId,r.resourceId,r.attemptId,r.generation,r.runtimeGeneration,r.userId,r.requestId,r.stageId,r.reservationId].every(v=>typeof v==='string'&&uuid.test(v))||![r.requestDigest,r.sourceDigest].every(v=>typeof v==='string'&&hash.test(v)))throw Error('PUBLICATION_CLAIM_INVALID');
 const purposes={publication:['readiness','publish'],'oex-import':['import'],'oex-export':['export'],'oex-freeze':['freeze']};
 if(!Object.hasOwn(purposes,r.operation)||!purposes[r.operation].includes(r.purpose))throw Error('PUBLICATION_CLAIM_INVALID');
 claimKeys(r.owner,'databaseOid,databaseSystemId,storeDevice,storeInode,storeRoot');
 if(![r.owner.databaseSystemId,r.owner.databaseOid,r.owner.storeDevice,r.owner.storeInode].every(v=>typeof v==='string'&&/^[0-9]{1,24}$/.test(v))||typeof r.owner.storeRoot!=='string'||!isAbsolute(r.owner.storeRoot)||!Array.isArray(r.plan)||r.plan.length<1||r.plan.length>4)throw Error('PUBLICATION_CLAIM_INVALID');
 for(const p of r.plan){claimKeys(p,'bytes,root');if(typeof p.root!=='string'||!isAbsolute(p.root)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>2147483648)throw Error('PUBLICATION_CLAIM_INVALID');}
}
async function claimFile(path:string){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await f.stat({bigint:true});if(!s.isFile()||s.size>BigInt(LIMIT)||(s.mode&0o077n)!==0n||s.uid!==BigInt(process.getuid?.()??-1))throw Error('PUBLICATION_CLAIM_UNCERTAIN');
  const b=Buffer.alloc(LIMIT+1);let n=0;while(n<b.length){const r=await f.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
  const after=await f.stat({bigint:true});if(BigInt(n)!==s.size||s.size!==after.size||s.ctimeNs!==after.ctimeNs||s.mtimeNs!==after.mtimeNs||s.nlink!==after.nlink)throw Error('PUBLICATION_CLAIM_UNCERTAIN');
  return {text:b.subarray(0,n).toString('utf8'),stat:s};
 }finally{await f.close();}
}
async function absent(path:string){try{await lstat(path);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}}
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
 private readonly resourceClaims:boolean;
 constructor(root:string,options?:{resourceClaims:true}){this.root=root;this.resourceClaims=options?.resourceClaims===true;}
 async claimJournalIdentity():Promise<Readonly<DiskClaimJournalBinding>>{
  if(!this.resourceClaims)throw Error('PUBLICATION_CLAIM_MODE_REQUIRED');
  await privateRoot(this.root);const s=await stat(this.root,{bigint:true});return Object.freeze({root:this.root,device:String(s.dev),inode:String(s.ino)});
 }
 private async claimWrite(path:string,text:string){
  if(Buffer.byteLength(text)>LIMIT)throw Error('PUBLICATION_CLAIM_INVALID');
  const f=await open(path,'wx',0o600);try{await f.writeFile(text);await f.sync();}finally{await f.close();}await syncDir(this.root);
 }
 private async coordinator(provider:PublicationDiskBudget){
  const journal=await this.claimJournalIdentity();
  if(!(provider instanceof PublicationDiskBudget)||canonical(provider.claimJournalIdentity())!==canonical(journal))throw Error('PUBLICATION_CLAIM_COORDINATOR');
  const coordinator=await provider.coordinatorIdentity(),text=canonical({version:1,kind:'resource-claim-provider',journal,coordinator}),path=join(this.root,'claim-provider.json');
  try{await this.claimWrite(path,text);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const actual=await claimFile(path);if(actual.stat.nlink!==1n||actual.text!==text)throw Error('PUBLICATION_CLAIM_COORDINATOR');return {journal,coordinator};
 }
 /** Caller holds the canonical operation fence. Persist this pending record
  * BEFORE acquiring capacity or starting any writer. Resource index and
  * attempt alias are hardlinks to one immutable record, not a second ledger. */
 async beginResourceClaim(provider:PublicationDiskBudget,input:ResourceClaimRequest):Promise<ResourceClaimHandle>{
  const request=claimSnapshot(input);validateClaimRequest(request);
  const {journal,coordinator}=await this.coordinator(provider);
  const actual=await stat(request.owner.storeRoot,{bigint:true});
  if(!actual.isDirectory()||await realpath(request.owner.storeRoot)!==request.owner.storeRoot||String(actual.dev)!==request.owner.storeDevice||String(actual.ino)!==request.owner.storeInode)throw Error('PUBLICATION_CLAIM_INVALID');
  for(const p of request.plan)if(await realpath(p.root)!==p.root||!(await stat(p.root)).isDirectory())throw Error('PUBLICATION_CLAIM_INVALID');
  const record:ResourceClaimRecord=claimSnapshot({...request,version:1,kind:'resource-claim',journal,coordinator});
  // The resource fence is tenant/resource only. Owner stays immutable inside
  // the record; switching a DB/store must not bypass an unresolved claim.
  const scope=sha256(Buffer.from(canonical({tenantId:request.tenantId,resourceId:request.resourceId}))),anchor=join(this.root,`resource-${scope}.claim.json`),alias=join(this.root,`${request.attemptId}.claim.json`);
  if(!await absent(anchor))throw Error('PUBLICATION_RESOURCE_CLAIMED');
  if(!await absent(alias)||!await absent(join(this.root,request.attemptId+'.json')))throw Error('PUBLICATION_CLAIM_ATTEMPT_REUSED');
  const text=canonical(record),pending=join(this.root,`.pending-claim-${request.attemptId}-${randomUUID()}`);
  await this.claimWrite(pending,text);
  // Every failure retains exact evidence. Incomplete links never grant a
  // working handle, but an existing anchor always blocks resource reassignment.
  try{await link(pending,anchor);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('PUBLICATION_RESOURCE_CLAIMED',{cause:error});throw error;}
  await syncDir(this.root);await link(pending,alias);await syncDir(this.root);await unlink(pending);await syncDir(this.root);
  const a=await claimFile(anchor),b=await claimFile(alias);
  if(a.text!==text||b.text!==text||a.stat.dev!==b.stat.dev||a.stat.ino!==b.stat.ino||a.stat.nlink!==2n||b.stat.nlink!==2n)throw Error('PUBLICATION_CLAIM_UNCERTAIN');
  const handle=Object.freeze({digest:sha256(Buffer.from(text))});issuedClaims.set(handle,{record,text,anchor,alias,device:a.stat.dev,inode:a.stat.ino});return handle;
 }
 private async activeClaim(handle:ResourceClaimHandle){
  const state=issuedClaims.get(handle);if(!state)throw Error('PUBLICATION_CLAIM_HANDLE_REQUIRED');
  if(canonical(await this.claimJournalIdentity())!==canonical(state.record.journal))throw Error('PUBLICATION_CLAIM_UNCERTAIN');
  for(const path of [state.anchor,state.alias]){const f=await claimFile(path);if(f.text!==state.text||f.stat.dev!==state.device||f.stat.ino!==state.inode||f.stat.nlink!==2n)throw Error('PUBLICATION_CLAIM_UNCERTAIN');}
  return state;
 }
 /** Attach only the real provider-generated generation after pending claim.
  * No missing binding, interrupted write or prior file is adopted on retry. */
 async bindReservation(provider:PublicationDiskBudget,handle:ResourceClaimHandle,binding:DiskReservationBinding,managerBindingDigest:string):Promise<Readonly<ResourceReservationRecord>>{
  const expected=claimSnapshot(binding);if(typeof managerBindingDigest!=='string'||!hash.test(managerBindingDigest))throw Error('PUBLICATION_CLAIM_INVALID');
  const state=await this.activeClaim(handle),ids=await this.coordinator(provider),r=state.record;
  if(canonical(ids.coordinator)!==canonical(r.coordinator)||expected.id!==r.reservationId||expected.operation!==r.operation||canonical(expected.owner)!==canonical(r.owner)||canonical(expected.plan)!==canonical(r.plan))throw Error('PUBLICATION_CLAIM_BINDING');
  const receipt=await provider.verifiedReceipt(expected),record:ResourceReservationRecord=claimSnapshot({version:1,kind:'resource-reservation',claimDigest:handle.digest,receipt,receiptDigest:diskReservationReceiptDigest(receipt),managerBindingDigest});
  await this.activeClaim(handle);if(state.binding)throw Error('PUBLICATION_CLAIM_ALREADY_BOUND');
  const text=canonical(record),alias=join(this.root,r.attemptId+'.reservation.json'),anchor=join(this.root,`reservation-${sha256(Buffer.from(canonical({coordinator:r.coordinator,id:receipt.id,generation:receipt.generation})))}.binding.json`),pending=join(this.root,`.pending-reservation-${r.attemptId}-${randomUUID()}`);
  if(!await absent(alias)||!await absent(anchor))throw Error('PUBLICATION_CLAIM_ALREADY_BOUND');
  await this.claimWrite(pending,text);await link(pending,anchor);await syncDir(this.root);await link(pending,alias);await syncDir(this.root);await unlink(pending);await syncDir(this.root);
  const a=await claimFile(anchor),b=await claimFile(alias);if(a.text!==text||b.text!==text||a.stat.dev!==b.stat.dev||a.stat.ino!==b.stat.ino||a.stat.nlink!==2n||b.stat.nlink!==2n)throw Error('PUBLICATION_CLAIM_UNCERTAIN');
  state.binding={text,alias,anchor,device:a.stat.dev,inode:a.stat.ino};return record;
 }
 /** Requires the original issued handle; serialized bytes after restart are
  * inspection data, never authority to resume or replace an unresolved claim. */
 async verifyResourceClaim(provider:PublicationDiskBudget,handle:ResourceClaimHandle){
  const state=await this.activeClaim(handle),ids=await this.coordinator(provider),r=state.record;
  if(canonical(ids.coordinator)!==canonical(r.coordinator))throw Error('PUBLICATION_CLAIM_BINDING');
  if(!state.binding)throw Error('PUBLICATION_CLAIM_UNBOUND');
  for(const path of [state.binding.anchor,state.binding.alias]){const f=await claimFile(path);if(f.text!==state.binding.text||f.stat.dev!==state.binding.device||f.stat.ino!==state.binding.inode||f.stat.nlink!==2n)throw Error('PUBLICATION_CLAIM_UNCERTAIN');}
  const binding=claimSnapshot(JSON.parse(state.binding.text)) as ResourceReservationRecord;
  claimKeys(binding,'claimDigest,kind,managerBindingDigest,receipt,receiptDigest,version');
  if(binding.version!==1||binding.kind!=='resource-reservation'||binding.claimDigest!==handle.digest||!hash.test(binding.managerBindingDigest)||binding.receiptDigest!==diskReservationReceiptDigest(binding.receipt)||binding.receipt.id!==r.reservationId||binding.receipt.operation!==r.operation||canonical(binding.receipt.owner)!==canonical(r.owner)||canonical(binding.receipt.plan.map(({root,bytes})=>({root,bytes})))!==canonical(r.plan))throw Error('PUBLICATION_CLAIM_BINDING');
  const live=await provider.verifiedReceipt({id:binding.receipt.id,generation:binding.receipt.generation,operation:r.operation,owner:r.owner,plan:r.plan});
  if(canonical(live)!==canonical(binding.receipt))throw Error('PUBLICATION_CLAIM_BINDING');
  await this.activeClaim(handle);return claimSnapshot({claim:r,claimDigest:handle.digest,binding});
 }
 /** Intentionally unavailable: no trusted same-fence Manager recovery/drain
  * verifier exists. A boolean, PID, terminal row or receipt cannot unlock it. */
 async retireResourceClaim(handle:ResourceClaimHandle):Promise<never>{void handle;throw Error('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');}
 async createForClaim(provider:PublicationDiskBudget,handle:ResourceClaimHandle,input:PublicationAttempt){
  const a=claimSnapshot(input);validate(a);const bound=await this.verifyResourceClaim(provider,handle),r=bound.claim;
  if(r.operation!=='publication'||a.attemptId!==r.attemptId||a.generation!==bound.binding.receipt.generation||a.runtimeGeneration!==r.runtimeGeneration||a.tenantId!==r.tenantId||a.userId!==r.userId||a.requestId!==r.requestId||a.exhibitionId!==r.resourceId||a.payloadHash!==r.requestDigest||canonical(a.owner)!==canonical(r.owner))throw Error('PUBLICATION_CLAIM_BINDING');
  await this.claimWrite(join(this.root,a.attemptId+'.json'),canonical(a));
 }
 /** Called while the publishing transaction holds 82003→82002, before the
  * first final put. Partial/uncertain records are retained, never adopted. */
 async create(input:PublicationAttempt){
  if(this.resourceClaims||!await absent(join(this.root,'claim-provider.json')))throw Error('PUBLICATION_CLAIM_HANDLE_REQUIRED');
  const a=JSON.parse(canonical(input)) as PublicationAttempt;validate(a);const text=canonical(a);if(Buffer.byteLength(text)>LIMIT)throw Error('PUBLICATION_ATTEMPT_INVALID');
  if(!await absent(join(this.root,a.attemptId+'.claim.json')))throw Error('PUBLICATION_CLAIM_HANDLE_REQUIRED');
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
  if(this.resourceClaims||!await absent(join(this.root,'claim-provider.json')))throw Error('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');
  if(!uuid.test(id))throw Error('PUBLICATION_ATTEMPT_INVALID');
  if(!await absent(join(this.root,id+'.claim.json')))throw Error('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');
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
