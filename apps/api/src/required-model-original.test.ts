// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {DetailFeatureReport} from '@exhibitos/studio-contract';
import type {Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {etag,type Studio} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,type CompactModelReceipt} from './oam-original-preparation.ts';
import {createModelPreparationReceipt,type ModelPreparationIntent} from './model-preparation-intent.ts';
import {approveRequiredModelOriginal,readRequiredModelOriginalApproval,readApprovedRequiredModelOriginal,resolveRequiredModelCandidate,resolveRequiredModelCustody,REQUIRED_MODEL_ORIGINAL_PROFILE} from './required-model-original.ts';

// These tests isolate custody/authority and byte-integrity boundaries. Structural
// GLB inspection has its own production inspector; no official model is loaded.
const inspect=vi.hoisted(()=>vi.fn());
vi.mock('./adopted-model-detail-report.ts',()=>({inspectAdoptedModelDetail:inspect}));

function fixture(provisional=false){
 const session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const artworkId=randomUUID(),revisionId=randomUUID(),jobId=randomUUID(),workspaceId=randomUUID(),originalId=randomUUID(),displayId=randomUUID();
 const original=Buffer.alloc(128,1),display=Buffer.alloc(96,2),revision=provisional?2:1;
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{download:true,display:true,export:true,commercial:false}};
 const bounds={min:[0,0,0] as [number,number,number],max:[1,1,1] as [number,number,number]};
 const intent:ModelPreparationIntent={version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:'ordinary-model',generation:'retained',artworkRevision:1,...(provisional?{sourceDisplayReference:{version:1 as const,status:'provisional-uncalibrated' as const,assetSha256:sha256(original),rawBounds:bounds,referenceHeightMeters:1.5,pose:{position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1.5,1.5,1.5] as [number,number,number]}}}:{})};
 const producer:CompactModelReceipt={version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,
  source:{bytes:original.length,sha256:sha256(original),triangles:1,vertices:3,bounds},
  output:{bytes:display.length,sha256:sha256(display),triangles:1,vertices:3,bounds,textureEdge:1,reusedOriginal:false},images:[],
  simplifier:{version:'1.1.1',relativeAppearanceError:0,lockedVertices:3},decoder:COMPACT_MODEL_RECIPE.decoder};
 const job={id:jobId,user_id:session.userId,artwork_id:artworkId,state:'approved',mime:'model/gltf-binary',asset_id:displayId,original_asset_id:originalId,
  object_key:'retained-original',approved_key:'approved-display',expected_hash:sha256(original),expected_bytes:original.length,rights,
  png_drain_version:1,lease_id:null,png_worker_tokens:[] as string[],model_preparation:{kind:'required-model-compact',request:intent,result:undefined as ReturnType<typeof createModelPreparationReceipt>|undefined}};
 const receipt=()=>{job.model_preparation.result=createModelPreparationReceipt(job,originalId,displayId,producer);return job.model_preparation.result;};receipt();
 const artwork={id:artworkId,revision,revisionId,artworkType:'sculpture',primaryAssetId:displayId,rights,assets:[{id:displayId,mime:'model/gltf-binary',sha256:sha256(display),bytes:display.length}]};
 const current={revision,approved_revision:revision,approved_asset_id:displayId};
 const cms={ownArtwork:vi.fn(async()=>current),studioArtwork:vi.fn(async()=>({artwork}))} as unknown as Cms;
 const imports={requiredModelReady:vi.fn(),coarseOwner:vi.fn(async()=>({workspaceId})),access:vi.fn(async()=>job),view:vi.fn(()=>({id:jobId,state:'approved',assetId:displayId}))} as unknown as Imports;
 const matches=[{id:jobId}],grants:{asset_id:string;metadata:unknown}[]=[];
 const query=vi.fn(async(sql:string,values?:unknown[])=>{
  if(sql.includes('SELECT id FROM import_jobs'))return {rows:matches,rowCount:matches.length};
  if(sql.includes('SELECT asset_id,metadata FROM asset_derivatives'))return {rows:grants,rowCount:grants.length};
  if(sql.startsWith('INSERT INTO asset_derivatives')){grants.push({asset_id:String(values?.[2]),metadata:structuredClone(values?.[3])});return {rows:[],rowCount:1};}
  return {rows:[],rowCount:0};
 });
 const client={query} as unknown as PoolClient,draft=newDraft();
 draft.candidate.artworks.push(artwork as never);
 const saved={revision:4,metadata:draft,studio_owner_user_id:session.userId};
 const studio={access:vi.fn(async()=>saved)} as unknown as Studio;
 const read=vi.fn(async(key:string)=>Buffer.from(key==='retained-original'?original:display)),blobs={getBounded:read} as unknown as BlobStore;
 const input:import('./required-model-original.ts').RequiredModelOriginalApproval={kind:REQUIRED_MODEL_ORIGINAL_PROFILE,artworkId,artworkRevision:revision,importJobId:jobId,serverReceiptSha256:job.model_preparation.result!.sha256};
 const report={version:1,inspector:'synthetic-structural-inspector',assetSha256:sha256(original),assetBytes:original.length,media:{kind:'glb'},cost:{model:'synthetic',residentBytes:1,peakAdditionalBytes:1}} as DetailFeatureReport;
 inspect.mockReset();inspect.mockResolvedValue(report);
 const custody=()=>resolveRequiredModelCustody(client,session,artworkId,revision,cms,imports);
 const approve=(value=input,match=etag(saved.revision,saved.metadata))=>approveRequiredModelOriginal(client,session,draft.exhibitionId,value,match,studio,cms,imports,blobs);
 const status=()=>readRequiredModelOriginalApproval(client,session,draft.exhibitionId,input,studio,cms,imports,blobs);
 return {session,artworkId,revision,jobId,originalId,displayId,original,display,rights,job,receipt,artwork,current,cms,imports,matches,grants,query,client,draft,saved,studio,read,blobs,input,custody,approve,status};
}

it('discovers retained ordinary custody at the current approved revision, including source-r1 to provisional-r2',async()=>{
 for(const provisional of [false,true]){
  const f=fixture(provisional),resolved=await f.custody();
  expect(resolved.custody).toMatchObject({kind:'required-model-custody-v1' as const,artworkId:f.artworkId,artworkRevision:f.revision,importJobId:f.jobId,serverReceiptSha256:f.input.serverReceiptSha256,original:{assetId:f.originalId,sha256:sha256(f.original)},display:{assetId:f.displayId,sha256:sha256(f.display)}});
  expect(f.imports.access).toHaveBeenCalledWith(f.client,f.session,f.jobId);
  const discovered=await resolveRequiredModelCandidate(f.client,f.session,f.artworkId,f.revision,f.cms,f.imports);
  expect(discovered).toMatchObject({id:f.jobId,requiredModelCustody:resolved.custody});
  expect(discovered).not.toHaveProperty('operationId');expect(f.read).not.toHaveBeenCalled();
 }
});

it('refuses stale CMS heads, ambiguous jobs and a revision increase without the supported source display reference',async()=>{
 const stale=fixture();stale.current.revision++;
 await expect(stale.custody()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');expect(stale.imports.access).not.toHaveBeenCalled();
 const ambiguous=fixture();ambiguous.matches.push({id:randomUUID()});
 await expect(ambiguous.custody()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');expect(ambiguous.imports.access).not.toHaveBeenCalled();
 const unsupported=fixture(true);delete unsupported.job.model_preparation.request.sourceDisplayReference;unsupported.receipt();
 await expect(unsupported.custody()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');
 const staleLineage=fixture();vi.mocked(staleLineage.imports.access).mockRejectedValueOnce(Error('MODEL_PREPARATION_RECEIPT_INVALID'));
 await expect(staleLineage.custody()).rejects.toThrow('MODEL_PREPARATION_RECEIPT_INVALID');
});

it('requires finished same-owner custody, current receipt and all original-publication rights',async()=>{
 for(const mutation of [(f:ReturnType<typeof fixture>)=>{f.job.user_id=randomUUID();},(f:ReturnType<typeof fixture>)=>{f.job.png_worker_tokens.push(randomUUID());},(f:ReturnType<typeof fixture>)=>{f.job.state='processing';},(f:ReturnType<typeof fixture>)=>{f.job.model_preparation.request.sourceFull={assetId:randomUUID(),approvalSHA256:'a'.repeat(64)};}]){
  const f=fixture();mutation(f);await expect(f.custody()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');
 }
 const corrupt=fixture();corrupt.job.model_preparation.result!.sha256='0'.repeat(64);
 await expect(corrupt.custody()).rejects.toThrow('MODEL_PREPARATION_RECEIPT_INVALID');
 const denied=fixture();denied.rights.permissions.download=false;denied.receipt();
 await expect(denied.custody()).rejects.toThrow('ORIGINAL_STATIC_RIGHTS_DENIED');
 const displayOnly=await resolveRequiredModelCandidate(denied.client,denied.session,denied.artworkId,denied.revision,denied.cms,denied.imports);
 expect(displayOnly).toMatchObject({state:'approved'});expect(displayOnly).not.toHaveProperty('requiredModelCustody');
 const expired=fixture();Object.assign(expired.rights,{expiresAt:'2099-01-01T00:00:00Z'});expired.receipt();
 await expect(expired.custody()).rejects.toThrow('ORIGINAL_STATIC_RIGHTS_DENIED');
});

it('checks owner and ETag before source reads, and refuses a different job, receipt or absent saved selection',async()=>{
 const stale=fixture();await expect(stale.approve(stale.input,etag(5,stale.draft))).rejects.toThrow('REMOTE_CONFLICT');expect(stale.read).not.toHaveBeenCalled();expect(stale.imports.access).not.toHaveBeenCalled();
 const foreign=fixture();foreign.saved.studio_owner_user_id=randomUUID();await expect(foreign.approve()).rejects.toThrow('FORBIDDEN');expect(foreign.read).not.toHaveBeenCalled();
 for(const change of [{importJobId:randomUUID()},{serverReceiptSha256:'a'.repeat(64)}]){const f=fixture();await expect(f.approve({...f.input,...change})).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');expect(f.read).not.toHaveBeenCalled();}
 const missing=fixture();missing.draft.candidate.artworks=[];await expect(missing.approve()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');expect(missing.read).not.toHaveBeenCalled();
});

it('persists one distinct ordinary approval, replays it and reads back actual approval without changing custody or draft',async()=>{
 const f=fixture(true),before=structuredClone({job:f.job,artwork:f.artwork,draft:f.draft});
 expect(await f.status()).toMatchObject({approved:false,approvalSha256:null});
 const approved=await f.approve(),replayed=await f.approve(),readback=await f.status();
 expect(approved).toEqual(replayed);expect(readback).toEqual(approved);
 expect(approved).toMatchObject({approved:true,exhibitionId:f.draft.exhibitionId,revision:4,etag:etag(4,f.draft),custody:{original:{assetId:f.originalId}}});
 expect(approved.approvalSha256).toMatch(/^[a-f0-9]{64}$/);expect(inspect).toHaveBeenCalledOnce();
 expect(f.grants).toHaveLength(1);expect(f.grants[0]?.metadata).toMatchObject({kind:'required-model-original-static-grant',originalAssetId:f.originalId,displayAssetId:f.displayId,input:f.input});
 expect({job:f.job,artwork:f.artwork,draft:f.draft}).toEqual(before);
 expect(f.query.mock.calls.some(([sql])=>sql.includes('native-model-adoption')||sql.startsWith('UPDATE '))).toBe(false);
 const source=await readApprovedRequiredModelOriginal(f.client,f.session,f.draft.exhibitionId,f.input,f.studio,f.cms,f.imports,f.blobs,new AbortController().signal);
 expect(source.bytes).toEqual(f.original);source.bytes.fill(0);
 f.grants.push(structuredClone(f.grants[0]!));await expect(f.status()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');
});

it('refuses corrupt original or display bytes before publishing an approval',async()=>{
 for(const key of ['retained-original','approved-display']){
  const f=fixture();f.read.mockImplementation(async(actual:string)=>actual===key?Buffer.alloc(actual==='retained-original'?f.original.length:f.display.length,9):Buffer.from(actual==='retained-original'?f.original:f.display));
  await expect(f.approve()).rejects.toThrow('REQUIRED_MODEL_ORIGINAL_UNAVAILABLE');expect(f.grants).toHaveLength(0);expect(inspect).not.toHaveBeenCalled();
 }
});
