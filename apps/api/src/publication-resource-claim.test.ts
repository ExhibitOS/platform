// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterAll,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,stat,readdir,readFile,writeFile,mkdir,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {PublicationDiskBudget,type DiskReservationBinding} from './publication-disk-budget.ts';
import {PublicationAttempts,type ResourceClaimRequest,type ResourceClaimHandle,type PublicationAttempt} from './publication-attempt.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-resource-claim-')));
afterAll(()=>rm(root,{recursive:true,force:true}));
async function fixture(){
 const journalRoot=await mkdtemp(join(root,'journal-')),budgetRoot=await mkdtemp(join(root,'budget-')),store=await mkdtemp(join(root,'store-')),s=await stat(store,{bigint:true}),journal=new PublicationAttempts(journalRoot);
 const request:ResourceClaimRequest={operation:'publication',purpose:'publish',tenantId:randomUUID(),resourceId:randomUUID(),attemptId:randomUUID(),generation:randomUUID(),runtimeGeneration:randomUUID(),userId:randomUUID(),requestId:randomUUID(),requestDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),stageId:randomUUID(),reservationId:randomUUID(),owner:{databaseSystemId:'123',databaseOid:'456',storeRoot:store,storeDevice:String(s.dev),storeInode:String(s.ino)},plan:[{root:store,bytes:1}]};
 const options={claimJournal:await journal.claimJournalIdentity()},budget=await PublicationDiskBudget.open(budgetRoot,options);
 return {journalRoot,budgetRoot,store,journal,request,options,budget};
}
async function bound(){const f=await fixture(),handle=await f.journal.beginResourceClaim(f.budget,f.request),lease=await f.budget.acquire(f.request.operation,f.request.owner,f.request.reservationId,f.request.plan),binding:DiskReservationBinding={id:lease.id,generation:lease.generation,operation:f.request.operation,owner:f.request.owner,plan:f.request.plan};await f.journal.bindReservation(f.budget,handle,binding,'c'.repeat(64));return {...f,handle,lease,binding};}
it('persists pending claim BEFORE allocation and blocks all operation kinds on that resource',async()=>{
 const f=await fixture(),handle=await f.journal.beginResourceClaim(f.budget,f.request);
 expect((await readdir(f.budgetRoot)).filter(n=>n.startsWith('lease-'))).toEqual([]);
 await expect(f.journal.verifyResourceClaim(f.budget,handle)).rejects.toThrow('PUBLICATION_CLAIM_UNBOUND');
 await expect(f.journal.beginResourceClaim(f.budget,{...f.request,operation:'oex-freeze',purpose:'freeze',attemptId:randomUUID(),reservationId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
 await mkdir(join(f.budgetRoot,'reservation.lock'),{mode:0o700});
 await expect(f.budget.acquire(f.request.operation,f.request.owner,f.request.reservationId,f.request.plan)).rejects.toMatchObject({code:'EEXIST'});
 await expect(new PublicationAttempts(f.journalRoot).beginResourceClaim(f.budget,{...f.request,attemptId:randomUUID(),reservationId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
});
it('binds the actual provider generation once and rejects raw release even with true proof',async()=>{
 const f=await bound(),verified=await f.journal.verifyResourceClaim(f.budget,f.handle);
 expect(verified.claim.generation).toBe(f.request.generation);expect(verified.binding.receipt.generation).toBe(f.lease.generation);expect(verified.claim.generation).not.toBe(f.lease.generation);
 expect(Object.isFrozen(verified.claim)).toBe(true);
 await expect(f.journal.bindReservation(f.budget,f.handle,f.binding,'d'.repeat(64))).rejects.toThrow('PUBLICATION_CLAIM_ALREADY_BOUND');
 const proof=vi.fn(async()=>true);
 await expect(f.lease.releaseAfter(proof)).rejects.toThrow('DISK_BUDGET_JOURNAL_RETIREMENT_UNAVAILABLE');
 const reopened=await PublicationDiskBudget.open(f.budgetRoot,f.options);await expect(reopened.release(f.lease.id,f.request.owner,f.lease.generation,proof)).rejects.toThrow('DISK_BUDGET_JOURNAL_RETIREMENT_UNAVAILABLE');expect(proof).not.toHaveBeenCalled();
 await expect(PublicationDiskBudget.open(f.budgetRoot)).rejects.toThrow('DISK_BUDGET_PROTOCOL');
 await expect(f.journal.retireResourceClaim(f.handle)).rejects.toThrow('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');
 await f.budget.verifyActive(f.binding);
});
it('refuses a second coordinator and preserves the old protocol without migration',async()=>{
 const f=await fixture();await f.journal.beginResourceClaim(f.budget,f.request);
 const other=await PublicationDiskBudget.open(await mkdtemp(join(root,'other-budget-')),f.options);
 await expect(f.journal.beginResourceClaim(other,{...f.request,resourceId:randomUUID(),attemptId:randomUUID()})).rejects.toThrow('PUBLICATION_CLAIM_COORDINATOR');
 const legacyRoot=await mkdtemp(join(root,'legacy-')),legacy=await PublicationDiskBudget.open(legacyRoot),before=await readFile(join(legacyRoot,'protocol.json'),'utf8');
 await expect(PublicationDiskBudget.open(legacyRoot,f.options)).rejects.toThrow('DISK_BUDGET_PROTOCOL');expect(await readFile(join(legacyRoot,'protocol.json'),'utf8')).toBe(before);
 const lease=await legacy.acquire('publication',f.request.owner,randomUUID(),f.request.plan);await lease.releaseAfter(async()=>true);
});
it('requires issued handles and detects modified or partial journal links without reclaiming',async()=>{
 const f=await bound();await expect(f.journal.verifyResourceClaim(f.budget,{digest:f.handle.digest})).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');
 const path=join(f.journalRoot,f.request.attemptId+'.reservation.json'),record=JSON.parse(await readFile(path,'utf8'));record.managerBindingDigest='f'.repeat(64);await writeFile(path,JSON.stringify(record));
 await expect(f.journal.verifyResourceClaim(f.budget,f.handle)).rejects.toThrow('PUBLICATION_CLAIM_UNCERTAIN');
 await unlink(join(f.journalRoot,f.request.attemptId+'.claim.json'));
 await expect(f.journal.beginResourceClaim(f.budget,{...f.request,attemptId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
});
it('keeps one reservation generation from being bound to two resource claims',async()=>{
 const f=await bound(),request={...f.request,resourceId:randomUUID(),attemptId:randomUUID()},other=await f.journal.beginResourceClaim(f.budget,request);
 await expect(f.journal.bindReservation(f.budget,other,f.binding,'c'.repeat(64))).rejects.toThrow('PUBLICATION_CLAIM_ALREADY_BOUND');
 await expect(f.journal.verifyResourceClaim(f.budget,other)).rejects.toThrow('PUBLICATION_CLAIM_UNBOUND');await f.journal.verifyResourceClaim(f.budget,f.handle);
});
it('preserves legacy manifests while claimed manifests require the bound handle',async()=>{
 const f=await bound(),a:PublicationAttempt={version:1,attemptId:f.request.attemptId,generation:f.lease.generation,runtimeGeneration:f.request.runtimeGeneration,owner:f.request.owner,tenantId:f.request.tenantId,userId:f.request.userId,requestId:f.request.requestId,exhibitionId:f.request.resourceId,etag:'"studio-r2-'+ 'c'.repeat(64)+'"',payloadHash:f.request.requestDigest,publicationId:randomUUID(),snapshotHash:'d'.repeat(64),objects:[]};
 await expect(f.journal.create(a)).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');await f.journal.createForClaim(f.budget,f.handle,a);expect(await f.journal.read(a.attemptId)).toEqual(a);
 const verifier=vi.fn(async()=>true);await expect(f.journal.recover({} as Pool,new FileBlobStore(f.store),a.attemptId,a.generation,verifier)).rejects.toThrow('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');expect(verifier).not.toHaveBeenCalled();
 const legacy={...a,attemptId:randomUUID()};await f.journal.create(legacy);expect(await f.journal.read(legacy.attemptId)).toEqual(legacy);
});
const childSource=`import {PublicationAttempts} from ${JSON.stringify(new URL('./publication-attempt.ts',import.meta.url).href)};import {PublicationDiskBudget} from ${JSON.stringify(new URL('./publication-disk-budget.ts',import.meta.url).href)};const [root,budgetRoot,request,phase]=JSON.parse(process.argv[1]);const j=new PublicationAttempts(root),b=await PublicationDiskBudget.open(budgetRoot,{claimJournal:await j.claimJournalIdentity()}),h=await j.beginResourceClaim(b,request);if(phase==='bound'){const l=await b.acquire(request.operation,request.owner,request.reservationId,request.plan);await j.bindReservation(b,h,{id:l.id,generation:l.generation,operation:request.operation,owner:request.owner,plan:request.plan},'c'.repeat(64));}process.stdout.write(JSON.stringify(h));process.exitCode=37;`;
it.each(['pending','bound'])('retains %s claims after creator process exits; a restart cannot adopt authority',async phase=>{
 const f=await fixture(),failure=await promisify(execFile)(process.execPath,['--input-type=module','-e',childSource,JSON.stringify([f.journalRoot,f.budgetRoot,f.request,phase])]).then(()=>{throw Error('expected synthetic owner exit');},(error:Error&{code:number;stdout:string})=>error);expect(failure.code).toBe(37);
 const handle=JSON.parse(failure.stdout) as ResourceClaimHandle,restarted=new PublicationAttempts(f.journalRoot),provider=await PublicationDiskBudget.open(f.budgetRoot,f.options);
 await expect(restarted.verifyResourceClaim(provider,handle)).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');
 await expect(restarted.beginResourceClaim(provider,{...f.request,attemptId:randomUUID(),reservationId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
 expect((await readdir(f.budgetRoot)).filter(n=>n.startsWith('lease-')).length).toBe(phase==='bound'?1:0);
});
it('atomically admits only one concurrent claim on the same canonical resource',async()=>{
 const f=await fixture();
 const results=await Promise.allSettled([f.journal.beginResourceClaim(f.budget,f.request),new PublicationAttempts(f.journalRoot).beginResourceClaim(f.budget,{...f.request,operation:'oex-import',purpose:'import',attemptId:randomUUID(),reservationId:randomUUID()})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await readdir(f.journalRoot)).filter(n=>n.startsWith('resource-')&&n.endsWith('.claim.json'))).toHaveLength(1);
});
