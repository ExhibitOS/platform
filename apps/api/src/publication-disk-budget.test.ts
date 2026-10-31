// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterAll,expect,it} from 'vitest';
import {mkdtemp,mkdir,realpath,stat,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PublicationDiskBudget,encodeDiskReservationReceipt,diskReservationReceiptDigest,type DiskReservationReceipt,type DiskOwner} from './publication-disk-budget.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-budget-boundary-')));
afterAll(()=>rm(root,{recursive:true,force:true}));
async function fixture(){const dir=await mkdtemp(join(root,'provider-')),store=await mkdtemp(join(root,'store-')),s=await stat(store,{bigint:true});const owner:DiskOwner={databaseSystemId:'123',databaseOid:'456',storeRoot:store,storeDevice:String(s.dev),storeInode:String(s.ino)};return {dir,store,owner,budget:await PublicationDiskBudget.open(dir)};}
it('persists across instances and retains uncertain leases until explicit proof',async()=>{
 const {dir,store,owner,budget}=await fixture(),id=randomUUID(),lease=await budget.acquire('publication',owner,id,[{root:store,bytes:1}]);
 expect(await readdir(dir)).toContain('lease-'+id+'.json');
 await expect(lease.releaseAfter(async()=>false)).rejects.toThrow('DISK_BUDGET_DRAIN_UNCONFIRMED');
 const next=await PublicationDiskBudget.open(dir);await next.release(id,owner,lease.generation,async generation=>generation===lease.generation);expect(await readdir(dir)).not.toContain('lease-'+id+'.json');
});
it('does not let a delayed release or stale handle delete a reacquired attempt',async()=>{
 const {dir,store,owner,budget}=await fixture(),id=randomUUID(),first=await budget.acquire('publication',owner,id,[{root:store,bytes:1}]);
 let enter!:()=>void,finish!:(value:boolean)=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;}),proof=new Promise<boolean>(resolve=>{finish=resolve;});
 const delayed=first.releaseAfter(async generation=>{expect(generation).toBe(first.generation);enter();return proof;});
 // Attach rejection immediately so a failing expectation cannot leak a rejection.
 const rejected=expect(delayed).rejects.toThrow('DISK_BUDGET_UNCERTAIN');
 await entered;await first.releaseAfter(async()=>true);
 const second=await budget.acquire('publication',owner,id,[{root:store,bytes:1}]);
 expect(second.generation).not.toBe(first.generation);finish(true);await rejected;
 await expect(first.releaseAfter(async()=>true)).rejects.toThrow('DISK_BUDGET_DRAIN_UNCONFIRMED');
 expect(await readdir(dir)).toContain('lease-'+id+'.json');await second.releaseAfter(async()=>true);
});
it('does not take over a stale mutex or an unmarked existing namespace',async()=>{
 const {dir,store,owner,budget}=await fixture();await mkdir(join(dir,'reservation.lock'),{mode:0o700});
 await expect(budget.acquire('publication',owner,randomUUID(),[{root:store,bytes:1}])).rejects.toMatchObject({code:'EEXIST'});
 const unknown=await mkdtemp(join(root,'unknown-'));await writeFile(join(unknown,'user-data'),'preserved');await expect(PublicationDiskBudget.open(unknown)).rejects.toThrow('DISK_BUDGET_PROTOCOL');expect(await readdir(unknown)).toEqual(['user-data']);
});
it('refuses another database bound to the same store and does not reuse an attempt',async()=>{
 const {store,owner,budget}=await fixture(),id=randomUUID();const lease=await budget.acquire('oex-export',owner,id,[{root:store,bytes:1}]);
 await expect(budget.acquire('publication',{...owner,databaseOid:'789'},randomUUID(),[{root:store,bytes:1}])).rejects.toThrow('DISK_BUDGET_STORE_IDENTITY');
 await expect(budget.acquire('oex-export',owner,id,[{root:store,bytes:1}])).rejects.toMatchObject({code:'EEXIST'});await lease.releaseAfter(async()=>true);
});
it('rejects malformed plans before reserving space and does not clear on a failed verifier',async()=>{
 const {dir,store,owner,budget}=await fixture();for(const bytes of [0,-1,NaN,2147483649])await expect(budget.acquire('publication',owner,randomUUID(),[{root:store,bytes}])).rejects.toThrow('DISK_BUDGET_PLAN');
 const lease=await budget.acquire('publication',owner,randomUUID(),[{root:store,bytes:1}]);await expect(lease.releaseAfter(async()=>{throw Error('DB unavailable');})).rejects.toThrow('DB unavailable');expect((await readdir(dir)).some(n=>n.startsWith('lease-'))).toBe(true);await lease.releaseAfter(async()=>true);
});
it('checks physical store identity independently of the canonical path binding',async()=>{
 const {dir,store,owner,budget}=await fixture();
 const binding='physical-'+createHash('sha256').update(owner.storeDevice+':'+owner.storeInode).digest('hex')+'.json';
 await writeFile(join(dir,binding),JSON.stringify({...owner,databaseOid:'999'}),{mode:0o600});
 await expect(budget.acquire('publication',owner,randomUUID(),[{root:store,bytes:1}])).rejects.toThrow('DISK_BUDGET_STORE_IDENTITY');
 expect((await readdir(dir)).some(n=>n.startsWith('lease-'))).toBe(false);
});
it('retains a child process reservation after exit and refuses a cross-process held mutex',async()=>{
 const {dir,store,owner,budget}=await fixture(),id=randomUUID();
 const source=`import {PublicationDiskBudget} from ${JSON.stringify(new URL('./publication-disk-budget.ts',import.meta.url).href)};const [root,owner,id,store]=JSON.parse(process.argv[1]);const lease=await (await PublicationDiskBudget.open(root)).acquire('oex-import',owner,id,[{root:store,bytes:1}]);process.stdout.write(lease.generation);`;
 const run=()=>promisify(execFile)(process.execPath,['--input-type=module','-e',source,JSON.stringify([dir,owner,id,store])]);
 await mkdir(join(dir,'reservation.lock'),{mode:0o700});
 await expect(run()).rejects.toMatchObject({stderr:expect.stringContaining('EEXIST')});
 await rm(join(dir,'reservation.lock'),{recursive:true});
 const {stdout:generation}=await run();expect(await readdir(dir)).toContain('lease-'+id+'.json');
 await expect(budget.release(id,owner,generation,async()=>false)).rejects.toThrow('DISK_BUDGET_DRAIN_UNCONFIRMED');
 await budget.release(id,owner,generation,async()=>true);
});
it('verifies exact active durable authority and rejects stale or altered claim bindings',async()=>{
 const {store,owner,budget}=await fixture(),id=randomUUID(),plan=[{root:store,bytes:1}],lease=await budget.acquire('oex-import',owner,id,plan);
 const binding={id,generation:lease.generation,operation:'oex-import' as const,owner,plan};
 await expect(budget.verifyActive(binding)).resolves.toBeUndefined();
 for(const wrong of [{...binding,generation:randomUUID()},{...binding,operation:'publication' as const},{...binding,plan:[{root:store,bytes:2}]},{...binding,owner:{...owner,databaseOid:'789'}}])await expect(budget.verifyActive(wrong)).rejects.toThrow('DISK_BUDGET_UNCERTAIN');
 await lease.releaseAfter(async()=>true);await expect(budget.verifyActive(binding)).rejects.toMatchObject({code:'ENOENT'});
});
it('matches the independent versioned UTF8 byte vector without Unicode or plan normalization',async()=>{
 const v=JSON.parse(await readFile(new URL('./fixtures/disk-reservation-v1.json',import.meta.url),'utf8')) as {receipt:DiskReservationReceipt;encodedHex:string;sha256:string};
 expect(encodeDiskReservationReceipt(v.receipt).toString('hex')).toBe(v.encodedHex);expect(diskReservationReceiptDigest(v.receipt)).toBe(v.sha256);
 expect(diskReservationReceiptDigest({...v.receipt,plan:[...v.receipt.plan].reverse()})).not.toBe(v.sha256);
 expect(diskReservationReceiptDigest({...v.receipt,owner:{...v.receipt.owner,storeRoot:v.receipt.owner.storeRoot.normalize('NFD')}})).not.toBe(v.sha256);
 let evaluated=false;const bad={...v.receipt};Object.defineProperty(bad,'owner',{enumerable:true,get:()=>{evaluated=true;return v.receipt.owner;}});
 expect(()=>encodeDiskReservationReceipt(bad)).toThrow('DISK_BUDGET_ENCODING');expect(evaluated).toBe(false);
 for(const value of [NaN,0,2147483649])expect(()=>encodeDiskReservationReceipt({...v.receipt,plan:[{...v.receipt.plan[0]!,bytes:value}]})).toThrow('DISK_BUDGET_ENCODING');
 expect(()=>encodeDiskReservationReceipt({...v.receipt,owner:{...v.receipt.owner,storeRoot:'/invalid/\ud800'}})).toThrow('DISK_BUDGET_ENCODING');
});
it('returns a frozen live receipt with actual plan devices, without creating new release authority',async()=>{
 const {store,owner,budget}=await fixture(),plan=[{root:store,bytes:1}],lease=await budget.acquire('publication',owner,randomUUID(),plan),binding={id:lease.id,generation:lease.generation,operation:'publication' as const,owner,plan};
 const receipt=await budget.verifiedReceipt(binding);
 expect(receipt.plan).toEqual([{root:store,bytes:1,device:owner.storeDevice}]);expect(Object.isFrozen(receipt)).toBe(true);expect(Object.isFrozen(receipt.owner)).toBe(true);expect(Object.isFrozen(receipt.plan)).toBe(true);expect(Object.isFrozen(receipt.plan[0])).toBe(true);
 expect(diskReservationReceiptDigest(receipt)).toMatch(/^[a-f0-9]{64}$/);
 await expect(lease.releaseAfter(async()=>false)).rejects.toThrow('DISK_BUDGET_DRAIN_UNCONFIRMED');
 await lease.releaseAfter(async()=>true);await expect(budget.verifiedReceipt(binding)).rejects.toMatchObject({code:'ENOENT'});
});
it('encodes an existing valid durable reservation with leading-zero database identifiers verbatim',async()=>{
 const {store,owner,budget}=await fixture(),legacy={...owner,databaseSystemId:'00123',databaseOid:'00456'},plan=[{root:store,bytes:1}],lease=await budget.acquire('publication',legacy,randomUUID(),plan);
 const receipt=await budget.verifiedReceipt({id:lease.id,generation:lease.generation,operation:'publication',owner:legacy,plan});
 expect(receipt.owner).toEqual(legacy);
 const bytes=encodeDiskReservationReceipt(receipt);expect(bytes.includes(Buffer.from('00123','utf8'))).toBe(true);expect(bytes.includes(Buffer.from('00456','utf8'))).toBe(true);
 expect(diskReservationReceiptDigest(receipt)).not.toBe(diskReservationReceiptDigest({...receipt,owner:{...legacy,databaseSystemId:'123',databaseOid:'456'}}));
 await lease.releaseAfter(async()=>true);
});
