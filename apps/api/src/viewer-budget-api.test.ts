import {writeOex,readOex} from '@exhibitos/spec';
import {projectPublication} from './publication.ts';
import {portableOexSnapshot} from './oex.ts';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {VIEWER_BUDGET_NAMESPACE as N,setViewerBudgetPolicy,viewerBudgetPolicyFor} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {Studio,etag,type Draft} from './studio.ts';
import type {Session} from './auth.ts';
import {analyzeViewerBudget,viewerBudgetSHA256} from './viewer-budget-analysis.ts';
import {ordinaryViewerBudgetPolicyDelta} from './viewer-budget-policy-delta.ts';
import {checkPortableOexProfile} from './oex-profile.ts';
const policy={version:1 as const,policyVersion:1 as const,targetProfile:'compact' as const,profiles:{compact:{admission:{colorDraws:900}}}};
function fixture(){
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session,studio=new Studio();
 const row={id:draft.exhibitionId,revision:2,metadata:draft,studio_owner_user_id:session.userId};
 const receipts=new Map<string,unknown>();
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.startsWith('SELECT * FROM studio_requests')){const receipt=receipts.get(args[2] as string);return {rows:receipt?[receipt]:[],rowCount:receipt?1:0};}
  if(sql.startsWith('UPDATE exhibitions SET metadata')){row.metadata=args[2] as typeof draft;row.revision=args[3] as number;}
  if(sql.startsWith('INSERT INTO studio_requests'))receipts.set(args[2] as string,{payload_sha256:args[3],exhibition_id:args[4],response:args[5]});
  return {rows:[],rowCount:0};
 });
 vi.spyOn(studio,'access').mockImplementation(async()=>row as never);
 return {draft,session,studio,row,query,c:{query} as unknown as PoolClient};
}
it('persists settings through ordinary save, reopens and resets them without altering another exhibition',async()=>{
 const f=fixture(),other=newDraft(),before=structuredClone(other),match=etag(2,f.draft);
 const saved=await f.studio.putViewerBudget(f.c,f.session,f.row.id,{requestId:randomUUID(),expectedRevision:2,policy},match);
 expect(saved.revision).toBe(3);expect(viewerBudgetPolicyFor((await f.studio.get(f.c,f.session,f.row.id)).draft.candidate)).toEqual(policy);
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO exhibition_revisions'))).toBe(true);
 expect(()=>checkPortableOexProfile(saved.draft.candidate)).not.toThrow();
 const reset=await f.studio.putViewerBudget(f.c,f.session,f.row.id,{requestId:randomUUID(),expectedRevision:3,policy:null},saved.etag);
 expect(reset.draft.candidate.extensions?.[N]).toBeUndefined();expect(other).toEqual(before);
});
it('replays a settings request durably after the head changed and rejects changed payload or stale CAS',async()=>{
 const f=fixture(),input={requestId:randomUUID(),expectedRevision:2,policy},match=etag(2,f.draft);
 const saved=await f.studio.putViewerBudget(f.c,f.session,f.row.id,input,match);
 expect(await f.studio.putViewerBudget(f.c,f.session,f.row.id,input,match)).toEqual(saved);
 await expect(f.studio.putViewerBudget(f.c,f.session,f.row.id,{...input,policy:null},match)).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
 await expect(f.studio.putViewerBudget(f.c,f.session,f.row.id,{...input,requestId:randomUUID()},match)).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
});
it('binds dirty inspection to the candidate and saved head without saving or pretending metadata is GPU usage',async()=>{
 const f=fixture(),dirty=structuredClone(f.draft);dirty.candidate=setViewerBudgetPolicy(dirty.candidate,policy);dirty.editVersion++;
 const result=await f.studio.viewerBudget(f.c,f.session,f.row.id,{context:'viewer'},{draft:dirty,requestId:randomUUID(),expectedRevision:2},etag(2,f.draft));
 expect(result.binding).toMatchObject({source:'draft',savedRevision:2,draftEditVersion:dirty.editVersion,inputSHA256:viewerBudgetSHA256(dirty.candidate)});
 expect(result.selection.effectiveProfile).toBe('compact');expect(result.estimates.wholeExhibition.evaluation.status).toBe('unknown');expect(result.inventory.decodedResidentBytes).toBeNull();
 expect(f.query).not.toHaveBeenCalled();
 await expect(f.studio.viewerBudget(f.c,f.session,f.row.id,{}, {draft:dirty,requestId:randomUUID(),expectedRevision:1},etag(2,f.draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
});
it('rejects stale observations and evaluates raised override through the same shared accounting without export denial',()=>{
 const f=fixture(),candidate=setViewerBudgetPolicy(f.draft.candidate,policy),binding={exhibitionId:f.row.id,savedRevision:2,etag:etag(2,f.draft),draftId:f.draft.id,draftEditVersion:f.draft.editVersion,source:'saved' as const},base=analyzeViewerBudget(candidate,binding);
 const observation={inputSHA256:base.binding.inputSHA256,policySHA256:base.policySHA256,policyVersion:1 as const,accountingVersion:1 as const,profile:'compact' as const,usage:{scope:'currentView' as const,complete:true,colorDraws:800,displayTriangles:1,shadowCasterTriangles:0,shadowDepthTriangles:0,residentBytes:0,transitionBytes:0,contributors:[]}};
 const result=analyzeViewerBudget(candidate,binding,{observations:[observation]});
 expect(result.estimates.currentView?.evaluation.admissionExceeded).toEqual([]);expect(result.exportConfiguration.performanceAdvisoryOnly).toBe(true);
 expect(()=>analyzeViewerBudget(candidate,binding,{observations:[{...observation,inputSHA256:'0'.repeat(64)}]})).toThrow('VIEWER_BUDGET_ANALYSIS_STALE');
 expect(()=>checkPortableOexProfile(candidate)).not.toThrow();
});
it('limits bounded policy delta to settings and normal bookkeeping and permits repairing invalid policy',()=>{
 const f=fixture(),before=structuredClone(f.draft);before.candidate.extensions={...before.candidate.extensions,[N]:{version:999}};
 const after={...before,candidate:setViewerBudgetPolicy(before.candidate,null),editVersion:before.editVersion+1} as Draft;
 expect(ordinaryViewerBudgetPolicyDelta(before,after)).toBe(true);
 after.candidate.title+=' unauthorized scene change';expect(ordinaryViewerBudgetPolicyDelta(before,after)).toBe(false);
 expect(()=>checkPortableOexProfile(before.candidate)).toThrow();
});
it('uses ordinary tenant/owner/role access for inspection and settings before any write',async()=>{
 const f=fixture(),studio=new Studio(),foreign={...f.row,studio_owner_user_id:randomUUID()},query=vi.fn(async(sql:string)=>{expect(sql).toContain('SELECT');return {rows:[foreign],rowCount:1};}),c={query} as unknown as PoolClient;
 await expect(studio.viewerBudget(c,{...f.session,role:'artist'},f.row.id)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(studio.putViewerBudget(c,{...f.session,role:'artist'},f.row.id,{requestId:randomUUID(),expectedRevision:2,policy},etag(2,f.draft))).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(query.mock.calls.every(([sql])=>sql.startsWith('SELECT id,revision,metadata'))).toBe(true);
 query.mockClear();await expect(studio.viewerBudget(c,{...f.session,role:'viewer'},f.row.id)).rejects.toMatchObject({code:'FORBIDDEN'});expect(query).not.toHaveBeenCalled();
});

it('retains final target and overrides in portable and public snapshots without turning performance policy into export rejection',()=>{
 const f=fixture(),candidate=setViewerBudgetPolicy(f.draft.candidate,{...policy,profiles:{compact:{admission:{colorDraws:1}}}}),original=structuredClone(candidate);
 const portable=portableOexSnapshot(candidate),projected=projectPublication(candidate,[],new Date().toISOString()).snapshot;
 expect(viewerBudgetPolicyFor(portable)).toEqual(viewerBudgetPolicyFor(candidate));expect(viewerBudgetPolicyFor(projected)).toEqual(viewerBudgetPolicyFor(candidate));expect(candidate).toEqual(original);
 const invalid=structuredClone(candidate);invalid.extensions![N]={version:99};expect(()=>projectPublication(invalid,[],new Date().toISOString())).toThrow('PUBLICATION_NOT_READY');
});

it('roundtrips target, overrides and reset through actual OEX bytes',async()=>{
 const f=fixture(),candidate=setViewerBudgetPolicy(f.draft.candidate,policy),options={createdAt:new Date().toISOString(),generator:{name:'ExhibitOS budget contract test',version:'1'}};
 const encoded=await writeOex(portableOexSnapshot(candidate),new Map(),options),decoded=await readOex(encoded);
 expect(viewerBudgetPolicyFor(decoded.exhibition)).toEqual(policy);
 const reset=setViewerBudgetPolicy(decoded.exhibition,null),reopened=await readOex(await writeOex(reset,new Map(),options));
 expect(reopened.exhibition.extensions?.[N]).toBeUndefined();
});
