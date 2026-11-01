// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,stat,rm,realpath,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it,vi} from 'vitest';
import {PublicationAttempts,samePublicationDiskOwner,type ResourceClaimRequest} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {nativeOwnerBindingDigest} from './native-owner-binding.ts';
import {bindOexOwnerClaim,sendOexClaimReady,requestSelectedSettlement,sendSelectedSettlementReceipt} from './oex-owner-claim.ts';
import {createNativeOexDiagnostic} from './native-oex-diagnostic.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('binds actual journal and provider records to the simulated owned-channel exchange',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-owner-claim-')));
 try{
  const [journalRoot,budgetRoot,store]=await Promise.all(['journal-','budget-','store-'].map(x=>mkdtemp(join(root,x)))),st=await stat(store!,{bigint:true});
  const journal=new PublicationAttempts(journalRoot!,{resourceClaims:true}),provider=await PublicationDiskBudget.open(budgetRoot!,{claimJournal:await journal.claimJournalIdentity()}),secret=Buffer.alloc(32,9);
  const request:ResourceClaimRequest={operation:'oex-import',purpose:'import',tenantId:id(1),resourceId:id(2),attemptId:id(3),generation:id(4),runtimeGeneration:id(5),userId:id(6),requestId:id(7),requestDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),stageId:id(8),reservationId:id(9),owner:{databaseSystemId:'1',databaseOid:'2',storeRoot:store!,storeDevice:String(st.dev),storeInode:String(st.ino)},plan:[{root:store!,bytes:1}]};
  const open={version:1,kind:'claim-open',correlationId:id(10),runtimeGeneration:id(5),workspaceId:id(11),tenantId:id(1),jobId:id(12)};
  let challenge:Record<string,string>={},ready={bytes:0},settle:Record<string,string>={};let phase=0;
  const channel={send:vi.fn(async(raw:Uint8Array)=>{const v=JSON.parse(Buffer.from(raw).toString());if(v.kind==='claim-challenge')challenge=v;else if(v.kind==='receipt-ready')ready=v;else if(v.kind==='settle-check')settle=v;}),receive:vi.fn(async()=>{
   if(phase++===0)return Buffer.from(JSON.stringify({version:1,kind:'read-receipt',correlationId:id(13),attemptId:id(3),offset:0,length:ready.bytes}));
   if(phase>2)return Buffer.from(JSON.stringify({...settle,kind:'settle-ready'}));
   const mac=nativeOwnerBindingDigest(secret,{workspaceId:id(11),tenantId:id(1),principalId:id(6),runtimeGeneration:id(5),jobId:id(12),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration!,claimDigest:challenge.claimDigest!,receiptDigest:challenge.receiptDigest!});
   return Buffer.from(JSON.stringify({version:1,kind:'claim-binding',correlationId:id(10),runtimeGeneration:id(5),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration,claimDigest:challenge.claimDigest,receiptDigest:challenge.receiptDigest,managerBindingDigest:mac}));
  }),close:vi.fn(async()=>{})};
  const diagnostic=createNativeOexDiagnostic();
  const result=await bindOexOwnerClaim({journal,provider,request,rawOpen:Buffer.from(JSON.stringify(open)),workspaceId:id(11),principalId:id(6),jobId:id(12),secret,channel,verifyLive:async()=>{},signal:new AbortController().signal,diagnostic});
  expect(diagnostic.report()).toBe('NATIVE_OEX_DIAGNOSTIC binding-verified OTHER unknown');
  const verified=await journal.verifyResourceClaim(provider,result.handle);
  expect(verified.binding.receiptDigest).toBe(result.receiptDigest);expect(channel.close).not.toHaveBeenCalled();
  expect(Object.getPrototypeOf(verified.claim.owner)).toBeNull();expect(samePublicationDiskOwner(request.owner,verified.claim.owner)).toBe(true);
  for(const key of ['databaseSystemId','databaseOid','storeRoot','storeDevice','storeInode'] as const)expect(samePublicationDiskOwner({...request.owner,[key]:request.owner[key]+'-changed'},verified.claim.owner)).toBe(false);
  const lease={jobId:id(12),requestId:id(7),userId:id(6),leaseId:id(14),archiveBytes:100,archiveSha256:'b'.repeat(64)},verifyLease=vi.fn(async()=>{}),readyFrame=await sendOexClaimReady(result,lease,verifyLease);
  expect(readyFrame.kind).toBe('claim-ready');expect(verifyLease).toHaveBeenCalledTimes(2);expect(verifyLease).toHaveBeenCalledWith(lease);
  await expect(sendOexClaimReady(result,lease,verifyLease)).rejects.toThrow('OEX_OWNER_CLAIM');
  const identity={correlationId:result.correlationId,attemptId:request.attemptId,runtimeGeneration:request.runtimeGeneration,generation:request.generation,reservationId:request.reservationId,reservationGeneration:result.receipt.generation,receiptDigest:result.receiptDigest};
  await expect(requestSelectedSettlement({} as typeof result,identity)).rejects.toThrow('OEX_SELECTED_SETTLEMENT');
  const authority=await requestSelectedSettlement(result,identity);await expect(requestSelectedSettlement(result,identity)).rejects.toThrow('OEX_SELECTED_SETTLEMENT');await journal.settleSelectedOex(provider,result.handle,authority,{exhibitionId:id(15),requestId:id(16),etag:'\"studio-r2-'+ 'd'.repeat(64)+'\"'});await sendSelectedSettlementReceipt(authority);
  expect((await readdir(budgetRoot!)).filter(n=>n.startsWith('lease-'))).toEqual([]);
  const names=await readdir(journalRoot!);expect(names).toContain(request.attemptId+'.settlement-terminal.json');expect(names).toContain(request.attemptId+'.reservation-released.json');expect(names.some(n=>n.startsWith('resource-'))).toBe(false);
  await expect(provider.releaseSelectedOex(result.binding,result.handle.digest,authority)).rejects.toThrow('OEX_SELECTED_SETTLEMENT');

 }finally{await rm(root,{recursive:true,force:true});}
},20000);

it.each([1,2,3,4])('retains exact blocking evidence if live owner is lost at settlement check %i',async failureAt=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-owner-loss-')));
 try{
  const [j,b,store]=await Promise.all(['journal-','budget-','store-'].map(x=>mkdtemp(join(root,x)))),st=await stat(store!,{bigint:true});
  const journal=new PublicationAttempts(j!,{resourceClaims:true}),provider=await PublicationDiskBudget.open(b!,{claimJournal:await journal.claimJournalIdentity()}),secret=Buffer.alloc(32,9);
  const request:ResourceClaimRequest={operation:'oex-import',purpose:'import',tenantId:id(1),resourceId:id(2),attemptId:id(3),generation:id(4),runtimeGeneration:id(5),userId:id(6),requestId:id(7),requestDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),stageId:id(8),reservationId:id(9),owner:{databaseSystemId:'1',databaseOid:'2',storeRoot:store!,storeDevice:String(st.dev),storeInode:String(st.ino)},plan:[{root:store!,bytes:1}]};
  const open={version:1,kind:'claim-open',correlationId:id(10),runtimeGeneration:id(5),workspaceId:id(11),tenantId:id(1),jobId:id(12)};
  let challenge:Record<string,string>={},ready={bytes:0},settle:Record<string,string>={},phase=0,checks=0,armed=false;
  const verifyLive=async()=>{if(armed&&++checks===failureAt)throw Error('OWNER_LOST');};
  const channel={send:async(raw:Uint8Array)=>{const v=JSON.parse(Buffer.from(raw).toString());if(v.kind==='claim-challenge')challenge=v;else if(v.kind==='receipt-ready')ready=v;else if(v.kind==='settle-check')settle=v;},receive:async()=>{
   if(phase++===0)return Buffer.from(JSON.stringify({version:1,kind:'read-receipt',correlationId:id(13),attemptId:id(3),offset:0,length:ready.bytes}));
   if(phase>2)return Buffer.from(JSON.stringify({...settle,kind:'settle-ready'}));
   const mac=nativeOwnerBindingDigest(secret,{workspaceId:id(11),tenantId:id(1),principalId:id(6),runtimeGeneration:id(5),jobId:id(12),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration!,claimDigest:challenge.claimDigest!,receiptDigest:challenge.receiptDigest!});
   return Buffer.from(JSON.stringify({version:1,kind:'claim-binding',correlationId:id(10),runtimeGeneration:id(5),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration,claimDigest:challenge.claimDigest,receiptDigest:challenge.receiptDigest,managerBindingDigest:mac}));
  },close:async()=>{}};
  const result=await bindOexOwnerClaim({journal,provider,request,rawOpen:Buffer.from(JSON.stringify(open)),workspaceId:id(11),principalId:id(6),jobId:id(12),secret,channel,verifyLive,signal:new AbortController().signal});
  await sendOexClaimReady(result,{jobId:id(12),requestId:id(7),userId:id(6),leaseId:id(14),archiveBytes:100,archiveSha256:'b'.repeat(64)},async()=>{});
  const authority=await requestSelectedSettlement(result,{correlationId:result.correlationId,attemptId:request.attemptId,runtimeGeneration:request.runtimeGeneration,generation:request.generation,reservationId:request.reservationId,reservationGeneration:result.receipt.generation,receiptDigest:result.receiptDigest});
  armed=true;
  await expect(journal.settleSelectedOex(provider,result.handle,authority,{exhibitionId:id(15),requestId:id(16),etag:'"studio-r2-'+ 'd'.repeat(64)+'"'})).rejects.toThrow('OWNER_LOST');
  const names=await readdir(j!);expect(names.some(n=>n.startsWith('resource-'))).toBe(true);
  const budgetNames=await readdir(b!);if(failureAt<4)expect(budgetNames).toContain('lease-'+request.reservationId+'.json');else expect(names).toContain(request.attemptId+'.reservation-released.json');
 }finally{await rm(root,{recursive:true,force:true});}
},20000);
