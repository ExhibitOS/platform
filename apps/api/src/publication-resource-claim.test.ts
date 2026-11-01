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
 const journalRoot=await mkdtemp(join(root,'journal-')),budgetRoot=await mkdtemp(join(root,'budget-')),store=await mkdtemp(join(root,'store-')),s=await stat(store,{bigint:true}),journal=new PublicationAttempts(journalRoot,{resourceClaims:true});
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
 await expect(new PublicationAttempts(f.journalRoot,{resourceClaims:true}).beginResourceClaim(f.budget,{...f.request,attemptId:randomUUID(),reservationId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
});
it('keeps the same tenant/resource claimed across owner changes and restart',async()=>{
 const f=await fixture();await f.journal.beginResourceClaim(f.budget,f.request);
 const otherStore=await mkdtemp(join(root,'different-store-')),s=await stat(otherStore,{bigint:true}),changed={...f.request,attemptId:randomUUID(),owner:{...f.request.owner,databaseSystemId:'999',databaseOid:'998',storeRoot:otherStore,storeDevice:String(s.dev),storeInode:String(s.ino)}};
 await expect(f.journal.beginResourceClaim(f.budget,changed)).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
 await expect(new PublicationAttempts(f.journalRoot,{resourceClaims:true}).beginResourceClaim(f.budget,changed)).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
});
it('rejects legacy create/recover before a claim, including concurrent different attempts',async()=>{
 const f=await fixture(),a:PublicationAttempt={version:1,attemptId:randomUUID(),generation:randomUUID(),owner:f.request.owner,tenantId:f.request.tenantId,userId:f.request.userId,requestId:f.request.requestId,exhibitionId:f.request.resourceId,etag:'"studio-r2-'+ 'c'.repeat(64)+'"',payloadHash:f.request.requestDigest,publicationId:randomUUID(),snapshotHash:'d'.repeat(64),objects:[]};
 const proof=vi.fn(async()=>true),results=await Promise.allSettled([f.journal.beginResourceClaim(f.budget,f.request),f.journal.create(a),f.journal.recover({} as Pool,new FileBlobStore(f.store),a.attemptId,a.generation,proof)]);
 expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected','rejected']);expect(proof).not.toHaveBeenCalled();expect(await readdir(f.journalRoot)).not.toContain(a.attemptId+'.json');
});
it('atomically selects a journal mode when a default legacy instance races first v2 initialization',async()=>{
 const f=await fixture(),a:PublicationAttempt={version:1,attemptId:randomUUID(),generation:randomUUID(),owner:f.request.owner,tenantId:f.request.tenantId,userId:f.request.userId,requestId:f.request.requestId,exhibitionId:f.request.resourceId,etag:'"studio-r2-'+ 'c'.repeat(64)+'"',payloadHash:f.request.requestDigest,publicationId:randomUUID(),snapshotHash:'d'.repeat(64),objects:[]};
 for(let i=0;i<8;i++){
  const dir=await mkdtemp(join(root,'mode-race-')),budgetRoot=await mkdtemp(join(root,'mode-budget-')),legacy=new PublicationAttempts(dir),modern=new PublicationAttempts(dir,{resourceClaims:true});
  const claim=async()=>{const budget=await PublicationDiskBudget.open(budgetRoot,{claimJournal:await modern.claimJournalIdentity()});return modern.beginResourceClaim(budget,f.request);};
  const results=await Promise.allSettled(i%2?[legacy.create(a),claim()]:[claim(),legacy.create(a)]),legacyResult=results[i%2?0:1],claimResult=results[i%2?1:0];
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const names=await readdir(dir);expect(names.includes(a.attemptId+'.json')).toBe(legacyResult.status==='fulfilled');expect(names.some(n=>n.startsWith('resource-'))).toBe(claimResult.status==='fulfilled');
 }
 const oldRoot=await mkdtemp(join(root,'unmarked-legacy-'));await writeFile(join(oldRoot,a.attemptId+'.json'),JSON.stringify(a),{mode:0o600});
 await expect(new PublicationAttempts(oldRoot,{resourceClaims:true}).claimJournalIdentity()).rejects.toThrow('PUBLICATION_CLAIM_MODE_CONFLICT');
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
 const legacy={...a,attemptId:randomUUID()},old=new PublicationAttempts(await mkdtemp(join(root,'legacy-journal-')));await old.create(legacy);expect(await old.read(legacy.attemptId)).toEqual(legacy);
 const sameRootOld=new PublicationAttempts(f.journalRoot);await expect(sameRootOld.create(legacy)).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');await expect(sameRootOld.recover({} as Pool,new FileBlobStore(f.store),legacy.attemptId,legacy.generation,verifier)).rejects.toThrow('PUBLICATION_CLAIM_RETIREMENT_UNAVAILABLE');
});
const childSource=`import {PublicationAttempts} from ${JSON.stringify(new URL('./publication-attempt.ts',import.meta.url).href)};import {PublicationDiskBudget} from ${JSON.stringify(new URL('./publication-disk-budget.ts',import.meta.url).href)};const [root,budgetRoot,request,phase]=JSON.parse(process.argv[1]);const j=new PublicationAttempts(root,{resourceClaims:true}),b=await PublicationDiskBudget.open(budgetRoot,{claimJournal:await j.claimJournalIdentity()}),h=await j.beginResourceClaim(b,request);if(phase==='bound'){const l=await b.acquire(request.operation,request.owner,request.reservationId,request.plan);await j.bindReservation(b,h,{id:l.id,generation:l.generation,operation:request.operation,owner:request.owner,plan:request.plan},'c'.repeat(64));}process.stdout.write(JSON.stringify(h));process.exitCode=37;`;
it('durably reports a bound outcome once without retiring or releasing its resource',async()=>{
 const f=await bound(),report={outcome:'succeeded' as const,databaseOutcome:'committed' as const,outputDigest:'d'.repeat(64)},record=await f.journal.recordResourceOutcome(f.budget,f.handle,report);
 expect(record.kind).toBe('resource-outcome-report');expect(record.claimDigest).toBe(f.handle.digest);expect(record.reservation?.generation).toBe(f.lease.generation);expect(Object.isFrozen(record.reservation)).toBe(true);
 expect(JSON.parse(await readFile(join(f.journalRoot,f.request.attemptId+'.outcome.json'),'utf8'))).toEqual(record);
 await expect(f.journal.verifyResourceClaim(f.budget,f.handle)).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_STARTED');
 await expect(f.journal.bindReservation(f.budget,f.handle,f.binding,'c'.repeat(64))).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_STARTED');
 await expect(f.journal.recordResourceOutcome(f.budget,f.handle,report)).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_STARTED');
 await expect(f.journal.beginResourceClaim(f.budget,{...f.request,attemptId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
 await expect(f.lease.releaseAfter(async()=>true)).rejects.toThrow('DISK_BUDGET_JOURNAL_RETIREMENT_UNAVAILABLE');await f.budget.verifyActive(f.binding);
});
it.each(['failed','cancelled'] as const)('retains an unbound %s report without implying that capacity is absent',async outcome=>{
 const f=await fixture(),h=await f.journal.beginResourceClaim(f.budget,f.request),lease=await f.budget.acquire(f.request.operation,f.request.owner,f.request.reservationId,f.request.plan);
 const record=await f.journal.recordResourceOutcome(f.budget,h,{outcome,databaseOutcome:'unknown',outputDigest:null});expect(record.reservation).toBeNull();
 await f.budget.verifyActive({id:lease.id,generation:lease.generation,operation:f.request.operation,owner:f.request.owner,plan:f.request.plan});
 await expect(new PublicationAttempts(f.journalRoot,{resourceClaims:true}).beginResourceClaim(f.budget,{...f.request,attemptId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
});
it('keeps commit uncertainty explicit and rejects invalid report input before closing a handle',async()=>{
 const f=await bound();await expect(f.journal.recordResourceOutcome(f.budget,f.handle,{outcome:'succeeded',databaseOutcome:'unknown',outputDigest:'d'.repeat(64)})).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_INVALID');
 await f.journal.verifyResourceClaim(f.budget,f.handle);
 const record=await f.journal.recordResourceOutcome(f.budget,f.handle,{outcome:'failed',databaseOutcome:'unknown',outputDigest:null});expect(record.databaseOutcome).toBe('unknown');await f.budget.verifyActive(f.binding);
});
it('preserves an existing outcome on write failure and irreversibly closes the handle',async()=>{
 const f=await bound(),path=join(f.journalRoot,f.request.attemptId+'.outcome.json');await writeFile(path,'retained-uncertain-evidence',{mode:0o600});
 await expect(f.journal.recordResourceOutcome(f.budget,f.handle,{outcome:'failed',databaseOutcome:'unknown',outputDigest:null})).rejects.toMatchObject({code:'EEXIST'});
 expect(await readFile(path,'utf8')).toBe('retained-uncertain-evidence');await expect(f.journal.verifyResourceClaim(f.budget,f.handle)).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_STARTED');await f.budget.verifyActive(f.binding);
});
it('admits only one concurrent outcome report and never turns it into restart authority',async()=>{
 const f=await bound(),report={outcome:'cancelled' as const,databaseOutcome:'unknown' as const,outputDigest:null};
 const results=await Promise.allSettled([f.journal.recordResourceOutcome(f.budget,f.handle,report),f.journal.recordResourceOutcome(f.budget,f.handle,report)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 await expect(new PublicationAttempts(f.journalRoot,{resourceClaims:true}).verifyResourceClaim(f.budget,{digest:f.handle.digest})).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');await f.budget.verifyActive(f.binding);
});
it.each(['binding','manifest'] as const)('refuses outcome closure while a %s write is in flight',async phase=>{
 const f=await fixture(),h=await f.journal.beginResourceClaim(f.budget,f.request),lease=await f.budget.acquire(f.request.operation,f.request.owner,f.request.reservationId,f.request.plan),binding={id:lease.id,generation:lease.generation,operation:f.request.operation,owner:f.request.owner,plan:f.request.plan};
 if(phase==='manifest')await f.journal.bindReservation(f.budget,h,binding,'c'.repeat(64));
 let entered!:()=>void,resume!:()=>void;const blocked=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{resume=r;});
 const seam=f.journal as unknown as {claimWrite(path:string,text:string):Promise<void>},original=seam.claimWrite.bind(f.journal),spy=vi.spyOn(seam,'claimWrite').mockImplementation(async(path,text)=>{if(phase==='binding'?path.includes('/.pending-reservation-'):path===join(f.journalRoot,f.request.attemptId+'.json')){entered();await gate;}await original(path,text);});
 const a:PublicationAttempt={version:1,attemptId:f.request.attemptId,generation:lease.generation,runtimeGeneration:f.request.runtimeGeneration,owner:f.request.owner,tenantId:f.request.tenantId,userId:f.request.userId,requestId:f.request.requestId,exhibitionId:f.request.resourceId,etag:'"studio-r2-'+ 'c'.repeat(64)+'"',payloadHash:f.request.requestDigest,publicationId:randomUUID(),snapshotHash:'d'.repeat(64),objects:[]};
 const running=phase==='binding'?f.journal.bindReservation(f.budget,h,binding,'c'.repeat(64)):f.journal.createForClaim(f.budget,h,a);
 try{await blocked;await expect(f.journal.recordResourceOutcome(f.budget,h,{outcome:'failed',databaseOutcome:'unknown',outputDigest:null})).rejects.toThrow('PUBLICATION_CLAIM_BUSY');await expect(f.journal.bindReservation(f.budget,h,binding,'c'.repeat(64))).rejects.toThrow('PUBLICATION_CLAIM_BUSY');expect(await readdir(f.journalRoot)).not.toContain(f.request.attemptId+'.outcome.json');}
 finally{resume();await running;spy.mockRestore();}
 await f.journal.verifyResourceClaim(f.budget,h);await f.journal.recordResourceOutcome(f.budget,h,{outcome:'failed',databaseOutcome:'unknown',outputDigest:null});
 await expect(f.journal.createForClaim(f.budget,h,a)).rejects.toThrow('PUBLICATION_CLAIM_OUTCOME_STARTED');await f.budget.verifyActive(binding);
});
it.each(['pending','bound'])('retains %s claims after creator process exits; a restart cannot adopt authority',async phase=>{
 const f=await fixture(),failure=await promisify(execFile)(process.execPath,['--input-type=module','-e',childSource,JSON.stringify([f.journalRoot,f.budgetRoot,f.request,phase])]).then(()=>{throw Error('expected synthetic owner exit');},(error:Error&{code:number;stdout:string})=>error);expect(failure.code).toBe(37);
 const handle=JSON.parse(failure.stdout) as ResourceClaimHandle,restarted=new PublicationAttempts(f.journalRoot,{resourceClaims:true}),provider=await PublicationDiskBudget.open(f.budgetRoot,f.options);
 await expect(restarted.verifyResourceClaim(provider,handle)).rejects.toThrow('PUBLICATION_CLAIM_HANDLE_REQUIRED');
 await expect(restarted.beginResourceClaim(provider,{...f.request,attemptId:randomUUID(),reservationId:randomUUID()})).rejects.toThrow('PUBLICATION_RESOURCE_CLAIMED');
 expect((await readdir(f.budgetRoot)).filter(n=>n.startsWith('lease-')).length).toBe(phase==='bound'?1:0);
});
it('atomically admits only one concurrent claim on the same canonical resource',async()=>{
 const f=await fixture();
 const results=await Promise.allSettled([f.journal.beginResourceClaim(f.budget,f.request),new PublicationAttempts(f.journalRoot,{resourceClaims:true}).beginResourceClaim(f.budget,{...f.request,operation:'oex-import',purpose:'import',attemptId:randomUUID(),reservationId:randomUUID()})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await readdir(f.journalRoot)).filter(n=>n.startsWith('resource-')&&n.endsWith('.claim.json'))).toHaveLength(1);
});
