import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {BlobStore} from '@exhibitos/storage';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID,createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {readOex,writeOex} from '@exhibitos/spec';
import {applyFurnishingCommand,setViewerBudgetPolicy,viewerBudgetPolicyFor,type ViewerBudgetPolicy} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';
import {admittedPublicationFurnishings,projectPublication} from './publication.ts';
import {portableOexSnapshot} from './oex.ts';
import {viewerBudgetSHA256} from './viewer-budget-analysis.ts';

// Source-only suites do not stage the compiled artifact; owner qualification does.
it.skipIf(!existsSync(new URL('../dist/viewer-budget-geometry.mjs',import.meta.url)))('runs the actual qualified CPU worker behind authenticated API, persists overrides and carries them into real catalogue output bytes',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='csrf',token='a'.repeat(43),draft=newDraft();
 for(const x of [-1,1]){const light=newLight(draft.candidate.rooms[0]!.id,'spot');light.transform.position=[x,2,0];draft.candidate.lights.push(light);draft.candidate=applyFurnishingCommand(draft.candidate,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}});}
 const low:ViewerBudgetPolicy={version:1,policyVersion:1,targetProfile:'standard',profiles:{standard:{admission:{colorDraws:1}}}};draft.candidate=setViewerBudgetPolicy(draft.candidate,low);
 const row={id:draft.exhibitionId,revision:2,metadata:draft,studio_owner_user_id:userId},receipts=new Map<string,unknown>(),catalogueLookups:unknown[][]=[];
 const session={id:randomUUID(),tenant_id:tenantId,user_id:userId,role:'artist',csrf_token:csrf,csrf_hash:createHash('sha256').update(csrf).digest('hex'),expires_at:new Date('2099-01-01T00:00:00Z')};
 const client=()=>({release:()=>{},query:async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id'))return {rows:[row],rowCount:1};
  if(sql.includes('FROM studio_furnishing_resources'))catalogueLookups.push(args);
  if(sql.startsWith('SELECT * FROM studio_requests')){const r=receipts.get(args[2] as string);return {rows:r?[r]:[],rowCount:r?1:0};}
  if(sql.startsWith('UPDATE exhibitions SET metadata')){row.metadata=args[2] as typeof draft;row.revision=args[3] as number;}
  if(sql.startsWith('INSERT INTO studio_requests'))receipts.set(args[2] as string,{payload_sha256:args[3],exhibition_id:args[4],response:args[5]});
  return {rows:[],rowCount:0};
 }});
 const pool={connect:async()=>client()} as unknown as Pool,origin='http://127.0.0.1:13200',app=buildApp({pool,auth:{mode:'local',origin,bindHost:'127.0.0.1'}}),headers={host:'127.0.0.1:13200',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${row.id}`;
 try{
  const first=await app.inject({method:'GET',url:url+'/viewer-budget',headers});expect(first.statusCode,first.body).toBe(200);
  const report=first.json();expect(report.estimates.wholeExhibition.basis).toBe('verified-cpu-producer');expect(report.estimates.wholeExhibition.usage.colorDraws).toBeGreaterThan(1);expect(report.estimates.wholeExhibition.evaluation.admissionExceeded).toContain('colorDraws');expect(report.estimates.analyzedSections.length).toBeGreaterThan(0);expect(report.inventory.downloadBytes).toBeNull();
  expect(catalogueLookups.length).toBeGreaterThanOrEqual(2);for(const args of catalogueLookups)expect(args.slice(0,2)).toEqual([tenantId,draft.exhibitionId]);
  const high:ViewerBudgetPolicy={version:1,policyVersion:1,targetProfile:'compact',profiles:{standard:{admission:{colorDraws:900}},compact:{admission:{colorDraws:900}}}},dirty=structuredClone(draft);dirty.candidate=setViewerBudgetPolicy(dirty.candidate,high);dirty.editVersion++;
  const inspection=await app.inject({method:'POST',url:url+'/viewer-budget-analysis',headers:{...headers,'if-match':etag(2,draft)},payload:{requestId:randomUUID(),expectedRevision:2,draft:dirty,options:{profile:'standard'}}});expect(inspection.statusCode,inspection.body).toBe(200);
  const inspected=inspection.json();expect(inspected.binding).toMatchObject({source:'draft',savedRevision:2,draftEditVersion:dirty.editVersion,inputSHA256:viewerBudgetSHA256(dirty.candidate)});expect(inspected.estimates.wholeExhibition.usage.colorDraws).toBe(report.estimates.wholeExhibition.usage.colorDraws);expect(inspected.estimates.wholeExhibition.evaluation.admissionExceeded).not.toContain('colorDraws');expect(row.revision).toBe(2);
  const saved=await app.inject({method:'PUT',url:url+'/viewer-budget',headers:{...headers,'if-match':etag(2,draft)},payload:{requestId:randomUUID(),expectedRevision:2,policy:high}});expect(saved.statusCode,saved.body).toBe(200);expect(row.revision).toBe(3);
  const target=await app.inject({method:'GET',url:url+'/viewer-budget',headers});expect(target.statusCode,target.body).toBe(200);expect(target.json().selection.effectiveProfile).toBe('compact');expect(target.json().resolvedPolicy.admission.colorDraws).toBe(900);
  const native=await app.inject({method:'GET',url:url+'/viewer-budget?context=native',headers});expect(native.statusCode,native.body).toBe(200);expect(native.json().selection.effectiveProfile).toBe('native');expect(native.json().estimates.wholeExhibition.usage.colorDraws).toBeGreaterThan(1);
  // Low policy with an actual CPU overage is still structurally exportable.
  const prepared=await admittedPublicationFurnishings(client() as unknown as PoolClient,{get:async()=>{throw Error('Unexpected imported source read');}} as unknown as BlobStore,tenantId,draft.exhibitionId,draft.candidate),published=projectPublication(draft.candidate,[],new Date().toISOString(),[],undefined,prepared).snapshot;expect(viewerBudgetPolicyFor(published)).toEqual(low);
  const files=new Map<string,Uint8Array>();for(const p of prepared){files.set(p.source.path,p.model);files.set(p.source.rights.notice.path,p.notice);}
  const codecOptions={createdAt:new Date().toISOString(),generator:{name:'Budget CPU API integration',version:'1'}},lowEncoded=await writeOex(portableOexSnapshot(draft.candidate),files,codecOptions);expect(viewerBudgetPolicyFor((await readOex(lowEncoded)).exhibition)).toEqual(low);
  const encoded=await writeOex(portableOexSnapshot(row.metadata.candidate),files,codecOptions),reopened=await readOex(encoded);expect(viewerBudgetPolicyFor(reopened.exhibition)).toEqual(high);
  const evidenceRoot=process.env.EXHIBITOS_VIEWER_BUDGET_EVIDENCE_DIR;
  if(evidenceRoot){await mkdir(evidenceRoot,{recursive:true});await writeFile(join(evidenceRoot,'actual-api-worker-fixture.json'),JSON.stringify({fixtureOnly:true,realPostgres:false,realGPU:false,candidate:draft.candidate,candidateSHA256:viewerBudgetSHA256(draft.candidate),lowReport:report,dirtyCandidate:dirty.candidate,dirtyCandidateSHA256:viewerBudgetSHA256(dirty.candidate),dirtyReport:inspected,savedDraft:row.metadata,targetReport:target.json(),nativeReport:native.json(),publishedSnapshot:published,codecSHA256:createHash('sha256').update(encoded).digest('hex'),codecCandidateSHA256:viewerBudgetSHA256(reopened.exhibition),codecPolicy:viewerBudgetPolicyFor(reopened.exhibition)},null,2)+'\n');await writeFile(join(evidenceRoot,'actual-api-worker-high-policy.oex'),encoded);await writeFile(join(evidenceRoot,'actual-api-worker-low-policy-overage.oex'),lowEncoded);}

 }finally{await app.close();}
},20000);
