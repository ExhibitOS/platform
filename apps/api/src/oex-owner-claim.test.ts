// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,stat,rm,realpath,readdir,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {PublicationAttempts,samePublicationDiskOwner,type ResourceClaimRequest} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {nativeOwnerBindingDigest} from './native-owner-binding.ts';
import {bindOexOwnerClaim,sendOexClaimReady,bindOexPreflightV3,verifyOexPreflightV3,acceptOexPackedReadyV3,requestOexOwnerDrainV3,requestSelectedV3Settlement,finishSelectedV3Settlement,requestSelectedSettlement,sendSelectedSettlementReceipt} from './oex-owner-claim.ts';
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
  const authority=await requestSelectedSettlement(result,identity);await expect(requestSelectedSettlement(result,identity)).rejects.toThrow('OEX_SELECTED_SETTLEMENT');await journal.settleSelectedOex(provider,result.handle,authority,{exhibitionId:id(15),requestId:id(16),etag:'"studio-r2-'+ 'd'.repeat(64)+'"'});await sendSelectedSettlementReceipt(authority);
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


it.each(['ok','bad-confirmation','zero','bad-stage','bad-output','abort-ready','bad-drain','drain-before','drain-after','settle','settle-zero','settle-bad-ack','settle-partial','settle-interrupt'] as const)('retains v3 preflight authority safely (%s)',async scenario=>{
 const zeroMode=scenario==='zero'||scenario==='settle-zero',settleMode=scenario.startsWith('settle');
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-owner-v3-')));
 try{
  const [j,b,store]=await Promise.all(['journal-','budget-','store-'].map(x=>mkdtemp(join(root,x)))),st=await stat(store!,{bigint:true}),stage=join(root,`native-oex-stage-${id(5)}`);await mkdir(stage,{mode:0o700});const stageStat=await stat(stage,{bigint:true});
  const journal=new PublicationAttempts(j!,{resourceClaims:true}),provider=await PublicationDiskBudget.open(b!,{claimJournal:await journal.claimJournalIdentity()}),secret=Buffer.alloc(32,9);
  const request:ResourceClaimRequest={operation:'oex-import',purpose:'import',tenantId:id(1),resourceId:id(2),attemptId:id(3),generation:id(4),runtimeGeneration:id(5),userId:id(6),requestId:id(7),requestDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),stageId:id(8),reservationId:id(9),owner:{databaseSystemId:'1',databaseOid:'2',storeRoot:store!,storeDevice:String(st.dev),storeInode:String(st.ino)},plan:[{root:stage,bytes:100}]};
  const open={version:1,kind:'claim-open-v3',correlationId:id(10),runtimeGeneration:id(5),workspaceId:id(11),tenantId:id(1),jobId:id(12)};
  let challenge:Record<string,string>={},ready={bytes:0},boundFrame:Record<string,string|null>={},drainFrame:Record<string,unknown>|undefined,settleFrame:Record<string,unknown>|undefined,receiptFrame:Record<string,unknown>|undefined,phase=0,confirmed=false,closePending:(()=>void)|undefined,enteredReady:(()=>void)|undefined;const waiting=new Promise<void>(resolve=>{enteredReady=resolve;});const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
  const channel={send:vi.fn(async(raw:Uint8Array)=>{const v=JSON.parse(Buffer.from(raw).toString());if(v.kind==='claim-challenge-v3')challenge=v;else if(v.kind==='receipt-ready')ready=v;else if(v.kind==='preflight-bound-v3')boundFrame=v;else if(v.kind==='drain-check-v3')drainFrame=v;else if(v.kind==='settle-check-v3')settleFrame=v;else if(v.kind==='settle-receipt-v3')receiptFrame=v;}),receive:vi.fn(async()=>{
   if(receiptFrame)return Buffer.from(JSON.stringify({...receiptFrame,kind:scenario==='settle-bad-ack'?'wrong':'settle-receipt-ack-v3'}));
   if(settleFrame)return Buffer.from(JSON.stringify({...settleFrame,kind:'settle-ready-v3'}));
   if(drainFrame)return Buffer.from(JSON.stringify({...drainFrame,kind:'drain-result-v3',status:scenario==='bad-drain'?'unknown':'drained'}));
   if(phase===0||phase===3&&!zeroMode){phase++;return Buffer.from(JSON.stringify({version:1,kind:'read-receipt',correlationId:phase===1?id(13):id(15),attemptId:id(3),offset:0,length:ready.bytes}));}
   if(phase++===1){const mac=nativeOwnerBindingDigest(secret,{workspaceId:id(11),tenantId:id(1),principalId:id(6),runtimeGeneration:id(5),jobId:id(12),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration!,claimDigest:challenge.claimDigest!,receiptDigest:challenge.receiptDigest!});
    return Buffer.from(JSON.stringify({version:1,kind:'claim-binding-v3',correlationId:id(10),runtimeGeneration:id(5),attemptId:id(3),generation:id(4),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration,claimDigest:challenge.claimDigest,receiptDigest:challenge.receiptDigest,managerBindingDigest:mac}));}
   if(phase===3){const control=Buffer.from(JSON.stringify({version:1,kind:'oex-preflight-v1',attemptId:id(3),runtimeGeneration:id(5),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration,reservationDigest:challenge.receiptDigest,archiveBytes:100,archiveSha256:'b'.repeat(64),inputDevice:String(stageStat.dev),inputInode:'123'}));
    const ack=Buffer.from(JSON.stringify({version:1,kind:'preflight-complete',attemptId:id(3),runtimeGeneration:id(5),stageId:id(8),reservationId:id(9),reservationGeneration:challenge.reservationGeneration,controlSha256:sha(control),archiveBytes:100,expandedBytes:30,packedBytes:zeroMode?0:25,manifestSha256:'d'.repeat(64),entryCount:zeroMode?2:3,archiveSha256:'b'.repeat(64),inputDevice:String(stageStat.dev),inputInode:'123'}));
    return Buffer.from(JSON.stringify({version:1,kind:'preflight-report-v3',correlationId:id(10),attemptId:id(3),runtimeGeneration:id(5),stageId:id(8),controlBase64:control.toString('base64'),controlSha256:sha(control),ackBase64:ack.toString('base64'),ackSha256:sha(ack)}));}
   if(!confirmed){confirmed=true;return Buffer.from(JSON.stringify({version:1,kind:'preflight-confirm-v3',correlationId:id(10),attemptId:id(3),runtimeGeneration:id(5),stageId:id(8),reportSha256:boundFrame.reportSha256,inputReceiptDigest:boundFrame.inputReceiptDigest,outputReceiptDigest:scenario==='bad-confirmation'?'0'.repeat(64):boundFrame.outputReceiptDigest}));}
   if(scenario==='abort-ready')return await new Promise<Buffer>((_resolve,reject)=>{closePending=()=>reject(Error('closed'));enteredReady?.();});
   return Buffer.from(JSON.stringify({version:1,kind:'packed-ready-v3',correlationId:id(10),attemptId:id(3),runtimeGeneration:id(5),stageId:id(8),reportSha256:boundFrame.reportSha256,inputReceiptDigest:boundFrame.inputReceiptDigest,outputReservationId:boundFrame.outputReservationId,outputReservationGeneration:boundFrame.outputReservationGeneration,outputReceiptDigest:boundFrame.outputReceiptDigest,archiveBytes:100,archiveSha256:'b'.repeat(64),inputDevice:String(stageStat.dev),inputInode:'123',outputDevice:String(stageStat.dev),outputInode:scenario==='bad-output'?'123':'124',packedBytes:zeroMode?0:25,manifestSha256:'d'.repeat(64)}));
  }),close:vi.fn(async()=>{closePending?.();})};
  let interruptOnPartial=false;const controller=new AbortController(),args={journal,provider,request,workspaceId:id(11),principalId:id(6),jobId:id(12),secret,channel,verifyLive:async()=>{if(interruptOnPartial&&(await readdir(b!)).filter(n=>n.startsWith('lease-')).length===1)throw Error('owner lost after first release');},signal:controller.signal};
  await expect(bindOexOwnerClaim({...args,rawOpen:Buffer.from(JSON.stringify(open))})).rejects.toThrow('OEX_OWNER_CLAIM');
  await expect(bindOexOwnerClaim({...args,variant:'v3',rawOpen:Buffer.from(JSON.stringify({...open,kind:'claim-open'}))})).rejects.toThrow('OEX_OWNER_CLAIM');
  const sameRoot={...request,owner:{...request.owner,storeRoot:stage,storeDevice:String(stageStat.dev),storeInode:String(stageStat.ino)}};
  await expect(bindOexOwnerClaim({...args,request:sameRoot,variant:'v3',rawOpen:Buffer.from(JSON.stringify(open))})).rejects.toThrow('OEX_OWNER_CLAIM');
  expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toEqual([]);
  const bound=await bindOexOwnerClaim({...args,variant:'v3',rawOpen:Buffer.from(JSON.stringify(open))});
  const lease={jobId:id(12),requestId:id(7),userId:id(6),leaseId:id(14),archiveBytes:100,archiveSha256:'b'.repeat(64)},frame=await sendOexClaimReady(bound,lease,async()=>{});expect(frame.kind).toBe('claim-ready-v3');
  await expect(requestSelectedSettlement(bound,{correlationId:bound.correlationId,attemptId:request.attemptId,runtimeGeneration:request.runtimeGeneration,generation:request.generation,reservationId:request.reservationId,reservationGeneration:bound.receipt.generation,receiptDigest:bound.receiptDigest})).rejects.toThrow('OEX_SELECTED_SETTLEMENT');
  await provider.verifyActive(bound.binding);expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toHaveLength(1);
  const stageInput=scenario==='bad-stage'?{stageDevice:String(stageStat.dev),stageInode:'123',extra:()=>{}}:{stageDevice:String(stageStat.dev),stageInode:'123'};
  let stageLive=true,leaseLive=true;
  await expect(verifyOexPreflightV3(bound)).rejects.toThrow('OEX_PREFLIGHT_BINDING');
  const guards={stage:stageInput,verifyStage:async()=>{if(!stageLive)throw Error('stage gone');},verifyLease:async()=>{if(!leaseLive)throw Error('lease gone');}};
  const preflight=bindOexPreflightV3(bound,guards);
  if(scenario==='bad-confirmation'||scenario==='bad-stage'){await expect(preflight).rejects.toThrow('OEX_PREFLIGHT_BINDING');expect(channel.close).toHaveBeenCalled();}
  else{const result=await preflight;expect(result.evidence.packedBytes).toBe(zeroMode?0:25);if(zeroMode)expect(result.outputReceipt).toBeNull();else expect(result.outputReceipt?.plan.map(p=>p.bytes)).toEqual([25,25]);expect((await journal.verifyOexPreflightReservation(provider,bound.handle)).evidence.packedBytes).toBe(zeroMode?0:25);await verifyOexPreflightV3(bound);await expect(verifyOexPreflightV3({...bound})).rejects.toThrow('OEX_PREFLIGHT_BINDING');
   if(scenario==='bad-output'){await expect(acceptOexPackedReadyV3(bound)).rejects.toThrow('OEX_PACKED_READY');expect(channel.close).toHaveBeenCalled();}else if(scenario==='abort-ready'){const pending=acceptOexPackedReadyV3(bound);await waiting;controller.abort();await expect(pending).rejects.toThrow('closed');expect(channel.close).toHaveBeenCalled();}else{expect(await acceptOexPackedReadyV3(bound)).toEqual({outputDevice:String(stageStat.dev),outputInode:'124'});expect(JSON.parse(Buffer.from(channel.send.mock.calls.at(-1)![0]).toString()).kind).toBe('packed-accepted-v3');await expect(acceptOexPackedReadyV3(bound)).rejects.toThrow('OEX_PACKED_READY');let calls=0;const nodeDrain=vi.fn(async()=>{calls++;if(scenario==='drain-before'&&calls===1||scenario==='drain-after'&&calls===2)throw Error('node not drained');});if(scenario==='bad-drain'||scenario==='drain-before'||scenario==='drain-after'){await expect(requestOexOwnerDrainV3(bound,nodeDrain)).rejects.toThrow(scenario==='bad-drain'?'OEX_OWNER_DRAIN_V3':'node not drained');expect(channel.close).toHaveBeenCalled();}else{await requestOexOwnerDrainV3(bound,nodeDrain);expect(nodeDrain).toHaveBeenCalledTimes(2);await expect(requestOexOwnerDrainV3(bound,nodeDrain)).rejects.toThrow('OEX_OWNER_DRAIN_V3');}}
   if(settleMode){const save={exhibitionId:id(19),etag:'"studio-r1-'+('f'.repeat(64))+'"',requestId:id(20)},committed=vi.fn(async()=>{});leaseLive=false;const authority=await requestSelectedV3Settlement(bound,save,committed);const receipt=result.outputReceipt,bindings=[bound.binding,...(receipt?[{id:receipt.id,generation:receipt.generation,operation:receipt.operation,owner:receipt.owner,plan:receipt.plan.map(({root,bytes})=>({root,bytes}))}]:[])];await expect(provider.releaseSelectedOexV3(bindings,bound.handle.digest,authority,{} as Parameters<typeof provider.releaseSelectedOexV3>[3])).rejects.toThrow('PUBLICATION_CLAIM_BINDING');expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toHaveLength(zeroMode?1:2);await expect(journal.settleSelectedOexV3(provider,bound.handle,authority,{...save,requestId:id(21)})).rejects.toThrow('OEX_V3_SETTLEMENT');if(scenario==='settle-partial'||scenario==='settle-interrupt'){const injected=scenario==='settle-partial'?vi.spyOn(PublicationDiskBudget.prototype,'releaseSelectedOexV3').mockImplementationOnce(async bindings=>{await unlink(join(b!,`lease-${bindings[1]!.id}.json`));throw Error('injected partial release');}):undefined;if(scenario==='settle-interrupt')interruptOnPartial=true;await expect(journal.settleSelectedOexV3(provider,bound.handle,authority,save)).rejects.toThrow(scenario==='settle-partial'?'injected partial release':'owner lost after first release');injected?.mockRestore();expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toEqual([`lease-${request.reservationId}.json`]);expect((await readdir(j!)).some(n=>n.endsWith('.settlement-terminal-v3.json'))).toBe(true);expect((await readdir(j!)).some(n=>n.endsWith('.reservation-released-v3.json'))).toBe(false);await expect(journal.settleSelectedOexV3(provider,bound.handle,authority,save)).rejects.toThrow();}else{await journal.settleSelectedOexV3(provider,bound.handle,authority,save);expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toHaveLength(0);expect((await readdir(j!)).some(n=>n.endsWith('.reservation-released-v3.json'))).toBe(true);if(scenario==='settle-bad-ack'){await expect(finishSelectedV3Settlement(authority)).rejects.toThrow('OEX_V3_SETTLEMENT');await expect(journal.finalizeSelectedOexV3(bound.handle,authority)).rejects.toThrow('OEX_V3_SETTLEMENT');}else{const pending=finishSelectedV3Settlement(authority);await expect(finishSelectedV3Settlement(authority)).rejects.toThrow('OEX_V3_SETTLEMENT');await pending;await journal.finalizeSelectedOexV3(bound.handle,authority);await expect(journal.finalizeSelectedOexV3(bound.handle,authority)).rejects.toThrow();}}expect((await readdir(j!)).some(n=>n.startsWith('resource-')&&n.endsWith('.claim.json'))).toBe(scenario==='settle-bad-ack'||scenario==='settle-partial'||scenario==='settle-interrupt');expect(committed).toHaveBeenCalled();}
   if(scenario!=='abort-ready'&&!settleMode){guards.verifyStage=async()=>{};guards.verifyLease=async()=>{};stageLive=false;await expect(verifyOexPreflightV3(bound)).rejects.toThrow('stage gone');stageLive=true;leaseLive=false;await expect(verifyOexPreflightV3(bound)).rejects.toThrow('lease gone');}}
  expect((await readdir(b!)).filter(n=>n.startsWith('lease-'))).toHaveLength(scenario==='settle-partial'||scenario==='settle-interrupt'?1:settleMode?0:zeroMode||scenario==='bad-stage'?1:2);
 }finally{await rm(root,{recursive:true,force:true});}
},20000);
