// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import {readApprovedModelCustody,replaceApprovedArtwork,resolveApprovedModelCandidate} from './artwork-replacement.ts';
import {etag,type Studio} from './studio.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {COMPACT_MODEL_RECIPE,COMPACT_MODEL_RECIPE_SHA256,type CompactModelReceipt} from './oam-original-preparation.ts';
import {createModelPreparationReceipt} from './model-preparation-intent.ts';

it('rejects stale draft and wrong owner before inspecting or mutating a job',async()=>{
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session,owner={workspaceId:randomUUID()},jobAccess=vi.fn(),client={query:vi.fn(async(sql:string)=>({rows:[],rowCount:sql.startsWith('SELECT * FROM studio_requests')?0:null}))} as unknown as PoolClient;
 const studio={access:vi.fn(async()=>({revision:1,metadata:draft,studio_owner_user_id:session.userId}))} as unknown as Studio,imports={coarseOwner:vi.fn(async()=>owner),access:jobAccess} as unknown as Imports,input={requestId:randomUUID(),artworkId:randomUUID(),importJobId:randomUUID(),artworkRevision:1};
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,etag(2,draft),studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('REMOTE_CONFLICT');expect(jobAccess).not.toHaveBeenCalled();
 vi.mocked(studio.access).mockResolvedValueOnce({revision:1,metadata:draft,studio_owner_user_id:randomUUID()} as never);
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,etag(1,draft),studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('FORBIDDEN');expect(jobAccess).not.toHaveBeenCalled();
});

it('replays an identical completed request after the draft changes, but rejects changed intent',async()=>{
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session,owner={workspaceId:randomUUID()},input={requestId:randomUUID(),artworkId:randomUUID(),importJobId:randomUUID(),artworkRevision:1},match=etag(1,draft),response={revision:2,etag:etag(2,draft),draft};
 const hash=createHash('sha256').update(JSON.stringify(['replace-approved-artwork-v1',session.tenantId,session.userId,owner.workspaceId,draft.exhibitionId,input.requestId,input.artworkId,input.artworkRevision,input.importJobId,match])).digest('hex');
 const client={query:vi.fn(async(sql:string)=>sql.startsWith('SELECT * FROM studio_requests')?{rows:[{payload_sha256:hash,exhibition_id:draft.exhibitionId,response}],rowCount:1}:{rows:[],rowCount:null})} as unknown as PoolClient,studio={access:vi.fn(async()=>({revision:2,metadata:draft,studio_owner_user_id:session.userId}))} as unknown as Studio,jobAccess=vi.fn(),imports={coarseOwner:vi.fn(async()=>owner),access:jobAccess} as unknown as Imports;
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,match,studio,{} as Cms,imports,{} as BlobStore)).resolves.toEqual(response);
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,{...input,importJobId:randomUUID()},match,studio,{} as Cms,imports,{} as BlobStore)).rejects.toThrow('REQUEST_CONFLICT');expect(jobAccess).not.toHaveBeenCalled();
});

it('does not discover or adopt the same-profile compact variant of an already approved model',async()=>{
 const draft=newDraft(),session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const artworkId=randomUUID(),placementId=randomUUID(),importJobId=randomUUID(),priorId=randomUUID(),priorRevisionId=randomUUID();
 const displayId=randomUUID(),sourceFull={assetId:randomUUID(),approvalSHA256:'f'.repeat(64)};
 const input={kind:'approved-model-candidate-v1' as const,requestId:randomUUID(),artworkId,placementId,importJobId,artworkRevision:1};
 const candidate={...draft.candidate,artworks:[{id:priorId,revisionId:priorRevisionId,artworkType:'sculpture'}],placements:[{id:placementId,artworkRevisionId:priorRevisionId}]};
 const saved={...draft,candidate} as typeof draft;
 const query=vi.fn(async()=>({rows:[],rowCount:0})),client={query} as unknown as PoolClient;
 const put=vi.fn(),studio={access:vi.fn(async()=>({revision:1,metadata:saved,studio_owner_user_id:session.userId})),putArtworkReplacement:put} as unknown as Studio;
 const project=vi.fn(),cms={ownArtwork:vi.fn(async()=>({revision:1,approved_revision:1,approved_asset_id:displayId})),studioArtwork:project} as unknown as Cms;
 const job={user_id:session.userId,artwork_id:artworkId,state:'approved',asset_id:displayId,mime:'model/gltf-binary',png_drain_version:1,lease_id:null,png_worker_tokens:[],model_preparation:{kind:'required-model-compact',request:{version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:randomUUID(),generation:'source-full',artworkRevision:1,sourceFull}}};
 const access=vi.fn(async()=>job),imports={coarseOwner:vi.fn(async()=>({workspaceId:randomUUID()})),requiredModelReady:vi.fn(),access} as unknown as Imports;

 await expect(resolveApprovedModelCandidate(client,session,artworkId,1,cms,imports)).rejects.toThrow('MODEL_CANDIDATE_NOT_READY');
 expect(query).toHaveBeenCalledWith(expect.stringContaining("(model_preparation->'request'->'sourceFull') IS NULL"),[session.tenantId,session.userId,artworkId,displayId,'1',COMPACT_MODEL_RECIPE.id]);
 expect(access).not.toHaveBeenCalled();
 await expect(replaceApprovedArtwork(client,session,draft.exhibitionId,input,etag(1,saved),studio,cms,imports,{} as BlobStore)).rejects.toThrow('MODEL_CANDIDATE_NOT_READY');
 expect(access).toHaveBeenCalledWith(client,session,importJobId);
 expect(project).not.toHaveBeenCalled();
 expect(put).not.toHaveBeenCalled();
});

it('reads both approved source artifacts only for the authenticated source owner',async()=>{
 const session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const artworkId=randomUUID(),revisionId=randomUUID(),jobId=randomUUID(),workspaceId=randomUUID();
 const original=Buffer.alloc(128,1),display=Buffer.alloc(96,2);
 const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
 const originalAssetId=randomUUID(),displayAssetId=randomUUID(),rights=structuredClone(syntheticArtwork('sculpture').rights);
 rights.permissions={download:true,display:true,export:true,commercial:false};
 const bounds={min:[0,0,0],max:[1,1,1]} as CompactModelReceipt['source']['bounds'];
 const producer:CompactModelReceipt={version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,
  source:{bytes:original.length,sha256:digest(original),triangles:1,vertices:3,bounds},
  output:{bytes:display.length,sha256:digest(display),triangles:1,vertices:3,bounds,textureEdge:1,reusedOriginal:false},
  images:[],simplifier:{version:'1.1.1',relativeAppearanceError:0,lockedVertices:3},decoder:COMPACT_MODEL_RECIPE.decoder};
 const job={id:jobId,artwork_id:artworkId,user_id:session.userId,state:'approved',mime:'model/gltf-binary',asset_id:displayAssetId,
  original_asset_id:originalAssetId,object_key:'original',approved_key:'display',expected_hash:digest(original),expected_bytes:original.length,
  lease_id:null,png_drain_version:1,png_worker_tokens:[],rights,model_preparation:{kind:'required-model-compact',
   request:{version:1,profileId:COMPACT_MODEL_RECIPE.id,operationID:'source',generation:'source',artworkRevision:1},
   result:undefined as ReturnType<typeof createModelPreparationReceipt>|undefined}};
 job.model_preparation.result=createModelPreparationReceipt(job,originalAssetId,displayAssetId,producer);
 const cms={ownArtwork:vi.fn(async()=>({revision:1,approved_revision:1,approved_asset_id:displayAssetId})),studioArtwork:vi.fn(async()=>({
  artwork:{id:artworkId,revision:1,revisionId,artworkType:'sculpture',rights,primaryAssetId:displayAssetId,
   assets:[{id:displayAssetId,mime:'model/gltf-binary',sha256:digest(display),bytes:display.length}]},
 }))} as unknown as Cms;
 const imports={coarseOwner:vi.fn(async()=>({workspaceId})),requiredModelReady:vi.fn(),access:vi.fn(async()=>job)} as unknown as Imports;
 const client={query:vi.fn(async()=>({rows:[{id:jobId}]}))} as unknown as PoolClient;
 const read=vi.fn(async(key:string)=>key==='original'?original:display),blobs={getBounded:read} as unknown as BlobStore;
 const run=()=>readApprovedModelCustody(client,session,artworkId,1,cms,imports,blobs);

 await expect(run()).resolves.toMatchObject({
  source:{workspaceId,tenantId:session.tenantId,principalId:session.userId,artworkId,artworkRevision:1,artworkRevisionId:revisionId},
  receipt:job.model_preparation.result,original,display,
 });
 expect(read).toHaveBeenCalledWith('original',original.length);
 expect(read).toHaveBeenCalledWith('display',display.length);
 read.mockImplementationOnce(async()=>Buffer.alloc(display.length,3));
 await expect(run()).rejects.toThrow('ASSET_INTEGRITY');
 read.mockImplementationOnce(async()=>display).mockImplementationOnce(async()=>Buffer.alloc(original.length,3));
 await expect(run()).rejects.toThrow('ASSET_INTEGRITY');
 read.mockClear();
 vi.mocked(imports.coarseOwner).mockRejectedValueOnce(Error('FORBIDDEN'));
 await expect(run()).rejects.toThrow('FORBIDDEN');
 rights.permissions.download=false;
 job.model_preparation.result=createModelPreparationReceipt(job,originalAssetId,displayAssetId,producer);
 await expect(run()).rejects.toThrow('RIGHTS_DENIED');
 expect(read).not.toHaveBeenCalled();
});
