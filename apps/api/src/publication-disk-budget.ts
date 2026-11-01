// SPDX-License-Identifier: AGPL-3.0-or-later
// Explicitly configured private coordinator for publication and OEX disk work.
// No PID, elapsed-time, or process-restart inference grants recovery authority.
import {mkdir,open,readdir,realpath,rmdir,lstat,stat,statfs,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {consumeSelectedSettlement,type SelectedSettlementAuthority} from './oex-owner-claim.ts';

export interface DiskOwner {databaseSystemId:string;databaseOid:string;storeRoot:string;storeDevice:string;storeInode:string}
export interface DiskPlan {root:string;bytes:number}
export interface DiskClaimJournalBinding {root:string;device:string;inode:string}
type DevicePlan=DiskPlan&{device:string};
export interface DiskReservationReceipt {version:1;id:string;generation:string;operation:'publication'|'oex-import'|'oex-export'|'oex-freeze';owner:DiskOwner;plan:DevicePlan[]}
type Record=DiskReservationReceipt;
export interface DiskReservationBinding {id:string;generation:string;operation:Record['operation'];owner:DiskOwner;plan:DiskPlan[]}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
/** Portable consistency encoding, NOT live authority. Version1 is ASCII magic
 * EXHIBITOS-DISK-RESERVATION NUL v1 NUL, then u32-BE length-prefixed exact UTF8
 * strings: id,generation,operation,databaseSystemId,databaseOid,storeRoot,
 * storeDevice,storeInode; u32-BE plan count; ordered root,device,decimal bytes
 * for each plan entry. Numeric identifier strings retain existing leading
 * zeros; byte counts use canonical decimal. No normalization, sorting, JSON or host-endian numbers.
 * The public fixture is normative. A digest never authorizes release/drain. */
export function encodeDiskReservationReceipt(input:DiskReservationReceipt):Buffer{
 const fail=()=>{throw Error('DISK_BUDGET_ENCODING');};
 const data=(v:unknown,keys:string[])=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).length!==keys.length) return fail();
  const result:{[key:string]:unknown}=Object.create(null) as {[key:string]:unknown};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return fail();result[key]=d.value;}
  return result;
 };
 const string=(v:unknown)=>{if(typeof v!=='string'||v.length>32768||v.includes('\0'))return fail();const b=Buffer.from(v,'utf8');if(b.length>32768||b.toString('utf8')!==v)return fail();return v;};
 const identifier=(v:unknown)=>{const s=string(v);if(!/^[0-9]{1,24}$/.test(s))return fail();return s;};
 const path=(v:unknown)=>{const s=string(v);if(!isAbsolute(s))return fail();return s;};
 const r=data(input,['version','id','generation','operation','owner','plan']),o=data(r.owner,['databaseSystemId','databaseOid','storeRoot','storeDevice','storeInode']);
 if(r.version!==1||!uuid.test(string(r.id))||!uuid.test(string(r.generation))||!['publication','oex-import','oex-export','oex-freeze'].includes(string(r.operation)))return fail();
 const plan=r.plan;
 if(!Array.isArray(plan)||plan.length<1||plan.length>4||Reflect.ownKeys(plan).length!==plan.length+1)return fail();
 const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const chunks=[Buffer.from('EXHIBITOS-DISK-RESERVATION\0v1\0','ascii')];
 const append=(s:string)=>{const bytes=Buffer.from(s,'utf8');chunks.push(u32(bytes.length),bytes);};
 for(const s of [string(r.id),string(r.generation),string(r.operation),identifier(o.databaseSystemId),identifier(o.databaseOid),path(o.storeRoot),identifier(o.storeDevice),identifier(o.storeInode)])append(s);
 chunks.push(u32(plan.length));
 for(let i=0;i<plan.length;i++){
  const d=Object.getOwnPropertyDescriptor(plan,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return fail();
  const p=data(d.value,['root','device','bytes']);
  if(typeof p.bytes!=='number'||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>2147483648)return fail();
  append(path(p.root));append(identifier(p.device));append(String(p.bytes));
 }
 const length=chunks.reduce((n,b)=>n+b.length,0);if(length>32768)return fail();return Buffer.concat(chunks,length);
}
export const diskReservationReceiptDigest=(input:DiskReservationReceipt)=>createHash('sha256').update(encodeDiskReservationReceipt(input)).digest('hex');
async function syncDirectory(path:string){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function privateDirectory(path:string){
 if(!isAbsolute(path)||await realpath(path)!==path)throw Error('DISK_BUDGET_ROOT');
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw Error('DISK_BUDGET_ROOT');
}
async function readBounded(path:string){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await f.stat({bigint:true});if(!s.isFile()||s.nlink!==1n||s.size>32768n||(s.mode&0o077n)!==0n||s.uid!==BigInt(process.getuid?.()??-1))throw Error('DISK_BUDGET_RECORD');const bytes=Buffer.alloc(32769);let count=0;while(count<bytes.length){const next=await f.read(bytes,count,bytes.length-count,count);if(!next.bytesRead)break;count+=next.bytesRead;}const after=await f.stat({bigint:true});if(count>32768||BigInt(count)!==s.size||s.size!==after.size||s.mtimeNs!==after.mtimeNs||s.ctimeNs!==after.ctimeNs)throw Error('DISK_BUDGET_RECORD');return bytes.subarray(0,count).toString('utf8');}finally{await f.close();}
}
async function durableNew(dir:string,name:string,value:unknown){
 const file=await open(join(dir,name),'wx',0o600);try{await file.writeFile(canonical(value));await file.sync();}finally{await file.close();}await syncDirectory(dir);
}
function validOwner(o:DiskOwner){return o&&Object.keys(o).sort().join(',')==='databaseOid,databaseSystemId,storeDevice,storeInode,storeRoot'&&[o.databaseSystemId,o.databaseOid,o.storeDevice,o.storeInode].every(v=>/^[0-9]{1,24}$/.test(v))&&isAbsolute(o.storeRoot);}
function parseRecord(text:string):Record{
 const r=JSON.parse(text) as Record;
 if(!r||Object.keys(r).sort().join(',')!=='generation,id,operation,owner,plan,version'||r.version!==1||!uuid.test(r.id)||!uuid.test(r.generation)||!['publication','oex-import','oex-export','oex-freeze'].includes(r.operation)||!validOwner(r.owner)||!Array.isArray(r.plan)||!r.plan.length||r.plan.length>4||r.plan.some(p=>!p||Object.keys(p).sort().join(',')!=='bytes,device,root'||!isAbsolute(p.root)||!/^[0-9]{1,24}$/.test(p.device)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>2147483648))throw Error('DISK_BUDGET_RECORD');
 return r;
}
/** One coordinator path must be shared by every qualified process using these
 * filesystems. Unknown/stale mutexes or leases fail closed. This class reserves
 * capacity only; it does not authorize deleting any blob or killing a child. */
export class PublicationDiskBudget {
 private readonly root:string;
 private readonly claims?:Readonly<DiskClaimJournalBinding>;
 private readonly protocol:string;
 private constructor(root:string,claims:Readonly<DiskClaimJournalBinding>|undefined,protocol:string){this.root=root;this.claims=claims;this.protocol=protocol;}
 static async open(root:string,options?:{claimJournal:DiskClaimJournalBinding}){
  const claims=options?Object.freeze({...options.claimJournal}):undefined;
  if(claims){
   if(Object.keys(claims).sort().join(',')!=='device,inode,root'||typeof claims.root!=='string'||![claims.device,claims.inode].every(v=>typeof v==='string'&&/^[0-9]{1,24}$/.test(v)))throw Error('DISK_BUDGET_JOURNAL');
   await privateDirectory(claims.root);const s=await stat(claims.root,{bigint:true});if(String(s.dev)!==claims.device||String(s.ino)!==claims.inode)throw Error('DISK_BUDGET_JOURNAL');
  }
  const protocol=claims?{version:2,kind:'exhibitos-disk-budget',claimJournal:claims}:{version:1,kind:'exhibitos-disk-budget'};
  await privateDirectory(root);const marker=join(root,'protocol.json');
  const names=await readdir(root);
  if(!names.includes('protocol.json')){if(names.length)throw Error('DISK_BUDGET_PROTOCOL');try{await durableNew(root,'protocol.json',protocol);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
  if(await readBounded(marker)!==canonical(protocol))throw Error('DISK_BUDGET_PROTOCOL');
  const result=new PublicationDiskBudget(root,claims,canonical(protocol));if(claims)Object.freeze(result);return result;
 }
 /** Protocol2 cannot be reopened unbound or silently upgrade a legacy store.
  * Journal binding is configuration, not a claim or retirement capability. */
 claimJournalIdentity(){return this.claims;}
 async coordinatorIdentity():Promise<Readonly<DiskClaimJournalBinding>>{
  await privateDirectory(this.root);if(await readBounded(join(this.root,'protocol.json'))!==this.protocol)throw Error('DISK_BUDGET_PROTOCOL');
  const s=await stat(this.root,{bigint:true});return Object.freeze({root:this.root,device:String(s.dev),inode:String(s.ino)});
 }
 private async mutex<T>(work:()=>Promise<T>){
  await this.coordinatorIdentity();
  if(this.claims){await privateDirectory(this.claims.root);const s=await stat(this.claims.root,{bigint:true});if(String(s.dev)!==this.claims.device||String(s.ino)!==this.claims.inode)throw Error('DISK_BUDGET_JOURNAL');}
  const path=join(this.root,'reservation.lock');
  await mkdir(path,{mode:0o700});
  try{return await work();}finally{await rmdir(path);await syncDirectory(this.root);}
 }
 private async checkOwner(owner:DiskOwner){
  if(!validOwner(owner)||await realpath(owner.storeRoot)!==owner.storeRoot)throw Error('DISK_BUDGET_OWNER');
  const s=await stat(owner.storeRoot,{bigint:true});if(!s.isDirectory()||String(s.dev)!==owner.storeDevice||String(s.ino)!==owner.storeInode)throw Error('DISK_BUDGET_OWNER');
 }
 async acquire(operation:Record['operation'],owner:DiskOwner,attemptId:string,plan:DiskPlan[]){
  if(!uuid.test(attemptId)||!['publication','oex-import','oex-export','oex-freeze'].includes(operation)||!Array.isArray(plan)||!plan.length||plan.length>4)throw Error('DISK_BUDGET_PLAN');
  // Snapshot all caller-owned values before the first asynchronous operation.
  owner={...owner};plan=plan.map(p=>({...p}));await this.checkOwner(owner);
  const requested:DevicePlan[]=[];
  for(const p of plan){if(!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>2147483648||!isAbsolute(p.root)||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_PLAN');const s=await stat(p.root,{bigint:true});if(!s.isDirectory())throw Error('DISK_BUDGET_PLAN');requested.push({...p,device:String(s.dev)});}
  const record:Record={version:1,id:attemptId,generation:randomUUID(),operation,owner,plan:requested};
  await this.mutex(async()=>{
   await this.checkOwner(owner);
   for(const p of requested){const s=await stat(p.root,{bigint:true});if(String(s.dev)!==p.device||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_UNCERTAIN');}
   // Bind both the canonical path and physical directory. A mount alias must
   // not let a different DB claim the same device/inode under a second path.
   for(const binding of ['store-'+digest(owner.storeRoot)+'.json','physical-'+digest(owner.storeDevice+':'+owner.storeInode)+'.json']){
    try{await durableNew(this.root,binding,owner);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(await readBounded(join(this.root,binding))!==canonical(owner))throw Error('DISK_BUDGET_STORE_IDENTITY');
   }
   const names=await readdir(this.root);if(names.some(n=>n!=='protocol.json'&&n!=='reservation.lock'&&!/^(store|physical)-[0-9a-f]{64}\.json$/.test(n)&&!/^lease-[0-9a-f-]{36}\.json$/.test(n)))throw Error('DISK_BUDGET_UNCERTAIN');
   const leases=names.filter(n=>n.startsWith('lease-'));if(leases.length>=16)throw Error('DISK_BUDGET_BUSY');
   const reserved=new Map<string,bigint>();
   for(const name of leases){const prior=parseRecord(await readBounded(join(this.root,name)));for(const p of prior.plan){const current=await stat(p.root,{bigint:true});if(String(current.dev)!==p.device||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_UNCERTAIN');reserved.set(p.device,(reserved.get(p.device)??0n)+BigInt(p.bytes));}}
   const demand=new Map<string,bigint>();for(const p of requested)demand.set(p.device,(demand.get(p.device)??0n)+BigInt(p.bytes));
   for(const [device,bytes]of demand){const p=requested.find(p=>p.device===device)!,capacity=await statfs(p.root,{bigint:true});if(capacity.bsize*capacity.bavail<(reserved.get(device)??0n)+bytes+1073741824n)throw Error('DISK_BUDGET_CAPACITY');}
   await durableNew(this.root,'lease-'+record.id+'.json',record);
  });
  return Object.freeze({id:record.id,generation:record.generation,releaseAfter:async(verifyDrain:(generation:string)=>Promise<boolean>)=>this.release(record.id,owner,record.generation,verifyDrain)});
 }
 /** Point-in-time durable authority check only. The consumer's terminal DB
  * fence must prevent release/respawn racing a subsequent job claim. Never run
  * a DB callback under this mutex or treat this as an atomic DB+FS grant. */
 async verifyActive(input:DiskReservationBinding):Promise<void>{
  await this.verifiedReceipt(input);
 }
 /** Snapshot issued only after the same locked live checks as verifyActive.
  * Includes actual device identity per plan. It is still point-in-time, never
  * continuous lifecycle authority or permission to retire a reservation. */
 async verifiedReceipt(input:DiskReservationBinding):Promise<Readonly<DiskReservationReceipt>>{
  const expected=JSON.parse(canonical(input)) as DiskReservationBinding;
  if(!uuid.test(expected.id)||!uuid.test(expected.generation)||!Array.isArray(expected.plan)||!expected.plan.length||expected.plan.length>4)throw Error('DISK_BUDGET_RECORD');
  return this.mutex(async()=>{
   await this.checkOwner(expected.owner);
   const record=parseRecord(await readBounded(join(this.root,'lease-'+expected.id+'.json')));
   if(record.id!==expected.id||record.generation!==expected.generation||record.operation!==expected.operation||canonical(record.owner)!==canonical(expected.owner)||canonical(record.plan.map(({root,bytes})=>({root,bytes})))!==canonical(expected.plan))throw Error('DISK_BUDGET_UNCERTAIN');
   for(const p of record.plan){const s=await stat(p.root,{bigint:true});if(!s.isDirectory()||String(s.dev)!==p.device||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_UNCERTAIN');}
   for(const p of record.plan)Object.freeze(p);Object.freeze(record.plan);Object.freeze(record.owner);return Object.freeze(record);
  });
 }
 /** verifyDrain must bind this generation to irreversible terminal DB outcome,
  * prevention of respawn, and actual file/child retirement. Recovery callers
  * obtain the generation from their durable attempt receipt, never by adopting
  * an unknown lease. Run BEFORE the filesystem mutex to avoid DB→mutex /
  * mutex→DB lock inversion. False or errors leave the durable reservation. */
 async release(id:string,owner:DiskOwner,generation:string,verifyDrain:(generation:string)=>Promise<boolean>){
  // No qualified Manager retirement verifier exists yet. Protocol2 therefore
  // has NO release capability: a callback(true) cannot bypass journal claims.
  if(this.claims)throw Error('DISK_BUDGET_JOURNAL_RETIREMENT_UNAVAILABLE');
  owner={...owner};if(!uuid.test(id)||!uuid.test(generation))throw Error('DISK_BUDGET_RECORD');await this.checkOwner(owner);
  const path=join(this.root,'lease-'+id+'.json'),before=await readBounded(path),record=parseRecord(before);
  if(record.generation!==generation||canonical(record.owner)!==canonical(owner)||!await verifyDrain(generation))throw Error('DISK_BUDGET_DRAIN_UNCONFIRMED');
  await this.mutex(async()=>{await this.checkOwner(owner);if(await readBounded(path)!==before)throw Error('DISK_BUDGET_UNCERTAIN');await unlink(path);await syncDirectory(this.root);});
 }
 /** Only the live selected-native operation can provide this one-use channel
  * capability. It does not grant restart recovery or delete staged bytes. */
 async releaseSelectedOex(binding:DiskReservationBinding,claimDigest:string,authority:SelectedSettlementAuthority){
  const expected=JSON.parse(canonical(binding)) as DiskReservationBinding;
  if(!this.claims||expected.operation!=='oex-import'||!uuid.test(expected.id)||!uuid.test(expected.generation))throw Error('DISK_BUDGET_JOURNAL_RETIREMENT_UNAVAILABLE');
  const revalidate=await consumeSelectedSettlement(authority,expected,claimDigest);
  await this.mutex(async()=>{
   await this.checkOwner(expected.owner);
   const path=join(this.root,'lease-'+expected.id+'.json'),raw=await readBounded(path),record=parseRecord(raw);
   if(record.id!==expected.id||record.generation!==expected.generation||record.operation!==expected.operation||canonical(record.owner)!==canonical(expected.owner)||canonical(record.plan.map(({root,bytes})=>({root,bytes})))!==canonical(expected.plan))throw Error('DISK_BUDGET_UNCERTAIN');
   for(const p of record.plan){const s=await stat(p.root,{bigint:true});if(!s.isDirectory()||String(s.dev)!==p.device||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_UNCERTAIN');}
   await revalidate();await unlink(path);await syncDirectory(this.root);
  });
 }
}
