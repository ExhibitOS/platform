// SPDX-License-Identifier: AGPL-3.0-or-later
// Explicitly configured private coordinator for publication and OEX disk work.
// No PID, elapsed-time, or process-restart inference grants recovery authority.
import {mkdir,open,readdir,realpath,rmdir,lstat,stat,statfs,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export interface DiskOwner {databaseSystemId:string;databaseOid:string;storeRoot:string;storeDevice:string;storeInode:string}
export interface DiskPlan {root:string;bytes:number}
type DevicePlan=DiskPlan&{device:string};
interface Record {version:1;id:string;generation:string;operation:'publication'|'oex-import'|'oex-export'|'oex-freeze';owner:DiskOwner;plan:DevicePlan[]}
export interface DiskReservationBinding {id:string;generation:string;operation:Record['operation'];owner:DiskOwner;plan:DiskPlan[]}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
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
 private constructor(root:string){this.root=root;}
 static async open(root:string){
  await privateDirectory(root);const marker=join(root,'protocol.json');
  const names=await readdir(root);
  if(!names.includes('protocol.json')){if(names.length)throw Error('DISK_BUDGET_PROTOCOL');try{await durableNew(root,'protocol.json',{version:1,kind:'exhibitos-disk-budget'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
  if(await readBounded(marker)!==canonical({version:1,kind:'exhibitos-disk-budget'}))throw Error('DISK_BUDGET_PROTOCOL');
  return new PublicationDiskBudget(root);
 }
 private async mutex<T>(work:()=>Promise<T>){
  await privateDirectory(this.root);const path=join(this.root,'reservation.lock');
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
  const expected=JSON.parse(canonical(input)) as DiskReservationBinding;
  if(!uuid.test(expected.id)||!uuid.test(expected.generation)||!Array.isArray(expected.plan)||!expected.plan.length||expected.plan.length>4)throw Error('DISK_BUDGET_RECORD');
  await this.mutex(async()=>{
   await this.checkOwner(expected.owner);
   const record=parseRecord(await readBounded(join(this.root,'lease-'+expected.id+'.json')));
   if(record.id!==expected.id||record.generation!==expected.generation||record.operation!==expected.operation||canonical(record.owner)!==canonical(expected.owner)||canonical(record.plan.map(({root,bytes})=>({root,bytes})))!==canonical(expected.plan))throw Error('DISK_BUDGET_UNCERTAIN');
   for(const p of record.plan){const s=await stat(p.root,{bigint:true});if(!s.isDirectory()||String(s.dev)!==p.device||await realpath(p.root)!==p.root)throw Error('DISK_BUDGET_UNCERTAIN');}
  });
 }
 /** verifyDrain must bind this generation to irreversible terminal DB outcome,
  * prevention of respawn, and actual file/child retirement. Recovery callers
  * obtain the generation from their durable attempt receipt, never by adopting
  * an unknown lease. Run BEFORE the filesystem mutex to avoid DB→mutex /
  * mutex→DB lock inversion. False or errors leave the durable reservation. */
 async release(id:string,owner:DiskOwner,generation:string,verifyDrain:(generation:string)=>Promise<boolean>){
  owner={...owner};if(!uuid.test(id)||!uuid.test(generation))throw Error('DISK_BUDGET_RECORD');await this.checkOwner(owner);
  const path=join(this.root,'lease-'+id+'.json'),before=await readBounded(path),record=parseRecord(before);
  if(record.generation!==generation||canonical(record.owner)!==canonical(owner)||!await verifyDrain(generation))throw Error('DISK_BUDGET_DRAIN_UNCONFIRMED');
  await this.mutex(async()=>{await this.checkOwner(owner);if(await readBounded(path)!==before)throw Error('DISK_BUDGET_UNCERTAIN');await unlink(path);await syncDirectory(this.root);});
 }
}
