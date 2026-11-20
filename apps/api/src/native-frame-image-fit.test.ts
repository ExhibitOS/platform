// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import type {Exhibition} from '@exhibitos/spec';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {sha256,FileBlobStore} from '@exhibitos/storage';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {WORKSPACE_FURNISHING_NAMESPACE as W,validateWorkspaceFurnishings,type FrameImageFit,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork,newPlacement} from '../../web/src/placement/model.ts';
import {nativeFrameImageFitProposal,nativeMeasuredFrameAttachmentProposal,requiresMeasuredFrameAttachmentFit} from './native-frame-image-fit.ts';
import {ordinaryFrameDelta} from './workspace-frame-delta.ts';
import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
import {buildApp} from './app.ts';
import {Studio,etag} from './studio.ts';
import type {Session} from './auth.ts';
function fixture(){
 const draft=newDraft(),art=syntheticArtwork('image');art.dimensions={width:.934,height:.732};art.assets[0]!.sha256='b'.repeat(64);
 const placement=newPlacement(art,draft.candidate.rooms[0]!.id);draft.candidate.artworks.push(art);draft.candidate.placements.push(placement);draft.candidate.accessibility.artworkDescriptions.push({placementId:placement.id,text:'Synthetic image'});
 const model={mime:'model/gltf-binary' as const,bytes:100,sha256:'a'.repeat(64)},source={id:randomUUID(),version:1 as const,kind:'artwork-frame' as const,name:'Synthetic measured frame',provenance:'Synthetic',rights:art.rights,model,fit:{version:1 as const,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'straight-miter-ring-v1' as const,openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012}}};
 const row={placementId:placement.id,artworkRevisionId:art.revisionId,assetId:art.primaryAssetId,furnishingId:source.id,furnishingVersion:1 as const,modelSha256:model.sha256};
 const value:WorkspaceFurnishings={version:9,furnishings:[source],placements:[],frameAttachments:[row],openingAttachments:[]};draft.candidate.extensions={...draft.candidate.extensions,[W]:value as never};
 const imageFit:FrameImageFit={version:1,profile:'contain-contact-v1',sourceSha256:'b'.repeat(64),pixelWidth:2048,pixelHeight:1630},command={type:'reconcile-frame-image-fit' as const,placementId:placement.id};
 const service={supportsArtworkFrame:()=>true,supportsCeilingRail:()=>true,hasWriterLease:()=>true,supportsReusableFit:()=>true,authorize:vi.fn(async()=>{}),readVersion:vi.fn(async(c:unknown,s:unknown,id:string):Promise<WorkspaceFurnishings['furnishings'][number]>=>{void c;void s;void id;return structuredClone(source);}),checkDisplay:vi.fn(async()=>structuredClone(source)),checkArtwork:vi.fn(async()=>{}),frameImageFit:vi.fn(async()=>structuredClone(imageFit))};
 return {draft,art,placement,source,row,value,imageFit,command,service};
}
async function railFixture(){
 const f=fixture();
 const candidate=JSON.parse(await readFile(new URL('./fixtures/rail-v11/exhibition.json',import.meta.resolve('@exhibitos/spec')),'utf8')) as Exhibition;
 f.draft.candidate=candidate;f.draft.exhibitionId=candidate.id;
 f.placement.roomId=candidate.rooms[0]!.id;
 candidate.artworks.push(f.art);candidate.placements.push(f.placement);
 candidate.accessibility.artworkDescriptions.push({placementId:f.placement.id,text:'Synthetic image'});
 const value=candidate.extensions![W] as unknown as WorkspaceFurnishings;
 value.furnishings.push(f.source);value.frameAttachments=[f.row];
 f.service.readVersion.mockImplementation(async(_c,_s,id)=>structuredClone(value.furnishings.find(item=>item.id===id)!));
 return {...f,value};
}
it.each([9,11])('reconciles exactly one v%s row, preserves descriptor/Z/photo/template and makes repeat proposal a semantic no-op',async version=>{
 const f=version===11?await railFixture():fixture(),before=structuredClone(f.draft),out=nativeFrameImageFitProposal(f.draft.candidate,f.command,f.imageFit),expected=structuredClone(f.draft.candidate),w=expected.extensions![W] as unknown as WorkspaceFurnishings;w.version=version===11?11:10;w.frameAttachments![0]!.imageFit=f.imageFit;
 const after=structuredClone(before);after.candidate=out.candidate;
 expect(out).toEqual({candidate:expected,placementId:f.placement.id});expect(f.draft).toEqual(before);expect(ordinaryFrameDelta(before,after,W)).toBe(true);
 expect(nativeFrameImageFitProposal(out.candidate,f.command,f.imageFit).candidate).toEqual(out.candidate);
 expect(()=>nativeFrameImageFitProposal(out.candidate,f.command,{...f.imageFit,pixelWidth:2047})).toThrow('FRAME_IMAGE_FIT_STALE');
 await expect(assertWorkspaceFurnishingSnapshot({} as PoolClient,{} as Session,out.candidate,f.service as never)).resolves.toBeUndefined();
 f.service.frameImageFit.mockResolvedValueOnce({...f.imageFit,pixelWidth:2047});await expect(assertWorkspaceFurnishingSnapshot({} as PoolClient,{} as Session,out.candidate,f.service as never)).rejects.toMatchObject({status:409,code:'FRAME_IMAGE_FIT_STALE'});
 const stripped=structuredClone(after);delete (stripped.candidate.extensions![W] as unknown as WorkspaceFurnishings).frameAttachments![0]!.imageFit;expect(ordinaryFrameDelta(after,stripped,W)).toBe(false);
});
it.each([9,11])('serves the closed ordinary v%s proposal with owner/head fencing and never persists it',async version=>{
 const f=version===11?await railFixture():fixture(),tenantId=randomUUID(),userId=randomUUID(),csrf='synthetic-csrf',revision=3,match=etag(revision,f.draft),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:f.draft.exhibitionId,revision,metadata:f.draft,studio_owner_user_id:userId}],rowCount:1};return {rows:[],rowCount:0};},release:()=>{}};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}};
 const blobs=new FileBlobStore('/synthetic-unused'),service=Object.assign(new WorkspaceFurnishingIntakes(blobs,owner),f.service);vi.spyOn(service,'work').mockResolvedValue(false);
 const app=buildApp({blobs,pool:{connect:async()=>client,query:client.query} as unknown as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeOexWorkspace:owner as never,nativeBoundedEditing:true,workspaceFurnishing:service});
 const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${'a'.repeat(43)}`,'x-csrf-token':csrf,'if-match':match},binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()},payload={expectedRevision:revision,request:{...binding,...f.command}},url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${f.draft.exhibitionId}/native-authoring-proposal`;
 const post=(value:unknown=payload,extra:Record<string,string>={})=>app.inject({method:'POST',url,headers:{...headers,...extra},payload:value as object});
 try{
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).toMatchObject({nativeFrameImageFitProposalProfile:'saved-head-frame-image-fit-v1',nativeMeasuredFrameAttachmentProposalProfile:'saved-head-measured-frame-attachment-v1'});
  expect((await post(payload,{'x-csrf-token':''})).statusCode).toBe(403);expect((await post({...payload,expectedRevision:2})).statusCode).toBe(412);expect((await post(payload,{'if-match':etag(2,f.draft)})).statusCode).toBe(412);
  expect((await post({...payload,request:{...payload.request,principalId:randomUUID()}})).statusCode).toBe(403);expect(f.service.frameImageFit).not.toHaveBeenCalled();
  expect((await post({...payload,request:{...payload.request,imageFit:f.imageFit}})).statusCode).toBe(400);
  const response=await post();expect(response.statusCode,response.body).toBe(200);expect(response.headers.etag).toBe(match);expect(response.json()).toEqual({...binding,...nativeFrameImageFitProposal(f.draft.candidate,f.command,f.imageFit)});expect(Object.keys(response.json()).sort()).toEqual([...Object.keys(binding),'candidate','placementId'].sort());
  f.service.readVersion.mockResolvedValueOnce({...f.source,name:'Stale descriptor'});expect((await post()).statusCode).toBe(422);
  f.service.frameImageFit.mockRejectedValueOnce(Error('RIGHTS_DENIED'));expect((await post()).statusCode).toBe(422);
  const measured={type:'attach-measured-frame' as const,placementId:f.placement.id,furnishingId:f.source.id,furnishingVersion:1 as const};
  const measuredRequest={...payload,request:{...binding,...measured}};
  const attached=await post(measuredRequest);
  expect(attached.statusCode,attached.body).toBe(200);
  expect(attached.headers.etag).toBe(match);
  expect(attached.json()).toEqual({...binding,...nativeMeasuredFrameAttachmentProposal(f.draft.candidate,measured,f.source,f.imageFit)});
  expect((await post({...measuredRequest,expectedRevision:2})).statusCode).toBe(412);
  expect((await post({...measuredRequest,request:{...measuredRequest.request,imageFit:f.imageFit}})).statusCode).toBe(400);
  f.service.frameImageFit.mockResolvedValueOnce({...f.imageFit,sourceSha256:'c'.repeat(64)});
  expect((await post(measuredRequest)).statusCode).toBe(422);
  expect(queries.filter(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toEqual([]);
 }finally{await app.close();}
});

it('reconciles supported metric placement scale through the existing proposal and snapshot checks',async()=>{
 for(const sx of [1.000709099666411,.9906979398504822]){
  const f=fixture();f.value.version=10;f.placement.transform.scale=[sx,1,1];f.placement.transform.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];f.art.transform.position=[.02,.03,.04];
  const before=structuredClone(f.draft),out=nativeFrameImageFitProposal(f.draft.candidate,f.command,f.imageFit),after=structuredClone(before);after.candidate=out.candidate;
  expect(f.draft).toEqual(before);expect(ordinaryFrameDelta(before,after,W)).toBe(true);
  expect(out.candidate.placements).toEqual(before.candidate.placements);expect(out.candidate.artworks).toEqual(before.candidate.artworks);expect(out.candidate.rooms).toEqual(before.candidate.rooms);
  expect((out.candidate.extensions![W] as unknown as WorkspaceFurnishings).frameAttachments![0]!.imageFit).toEqual(f.imageFit);
  await expect(assertWorkspaceFurnishingSnapshot({} as PoolClient,{} as Session,out.candidate,f.service as never)).resolves.toBeUndefined();
 }
});

it('preflights, saves and reads back a v11 contact fit while preserving the rail and every unrelated field',async()=>{
 const f=await railFixture(),before=structuredClone(f.draft);
 const out=nativeFrameImageFitProposal(f.draft.candidate,f.command,f.imageFit),next=structuredClone(f.draft);next.candidate=out.candidate;next.editVersion++;
 expect(validateWorkspaceFurnishings(out.candidate).valid).toBe(true);
 const workspace=out.candidate.extensions![W] as unknown as WorkspaceFurnishings;
 expect(workspace.version).toBe(11);expect(workspace.ceilingAttachments).toEqual(f.value.ceilingAttachments);
 const expected=structuredClone(before);expected.editVersion=next.editVersion;
 (expected.candidate.extensions![W] as unknown as WorkspaceFurnishings).frameAttachments![0]!.imageFit=f.imageFit;
 expect(next).toEqual(expected);expect(f.draft).toEqual(before);expect(ordinaryFrameDelta(before,next,W)).toBe(true);
 const client={query:vi.fn(async()=>({rows:[],rowCount:0}))} as unknown as PoolClient;
 const session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const studio=new Studio({workspaceId:randomUUID()} as never,true,undefined,f.service as never);
 const row={id:f.draft.exhibitionId,revision:2,metadata:f.draft,nativeBounded:false};
 vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const input={draft:next,requestId:randomUUID()},match=etag(row.revision,row.metadata);
 await expect(studio.validateNativeViewport(client,session,f.draft.exhibitionId,input,match)).resolves.toEqual({valid:true});
 const saved=await studio.put(client,session,f.draft.exhibitionId,input,match);
 expect(saved.draft).toEqual(next);expect(saved.revision).toBe(3);expect(saved.etag).toBe(etag(3,next));
 const broken=structuredClone(next);(broken.candidate.extensions![W] as unknown as WorkspaceFurnishings).ceilingAttachments![0]!.gap+=.01;
 expect(ordinaryFrameDelta(before,broken,W)).toBe(false);
 const downgraded=structuredClone(next);(downgraded.candidate.extensions![W] as unknown as WorkspaceFurnishings).version=10;
 expect(validateWorkspaceFurnishings(downgraded.candidate).valid).toBe(false);expect(ordinaryFrameDelta(before,downgraded,W)).toBe(false);
});

it('attaches the landscape straight ring and returns the exact same fitted draft on a repeat',()=>{
 const f=fixture();
 delete f.draft.candidate.extensions![W];
 const source={...f.source,fit:{...f.source.fit,geometry:{profile:'straight-ring-v1' as const,openingWidth:.94,openingHeight:.738,imagePlaneZ:-.012}}};
 const command={type:'attach-measured-frame' as const,placementId:f.placement.id,furnishingId:source.id,furnishingVersion:1 as const};
 const before=structuredClone(f.draft);
 const {candidate}=nativeMeasuredFrameAttachmentProposal(f.draft.candidate,command,source,f.imageFit);
 expect(f.draft).toEqual(before);
 const value=candidate.extensions![W] as unknown as WorkspaceFurnishings;
 expect(value).toEqual({version:10,furnishings:[source],placements:[],frameAttachments:[{...f.row,imageFit:f.imageFit}],openingAttachments:[]});
 expect(candidate.artworks).toEqual(before.candidate.artworks);
 expect(candidate.placements).toEqual(before.candidate.placements);
 expect(nativeMeasuredFrameAttachmentProposal(candidate,command,source,f.imageFit).candidate).toEqual(candidate);
 expect(()=>nativeMeasuredFrameAttachmentProposal(candidate,command,{...source,model:{...source.model,sha256:'c'.repeat(64)}},f.imageFit)).toThrow();
});

it('replaces a portrait frame with one fitted candidate and one ordinary CAS write',async()=>{
 const f=fixture(),draft=f.draft;
 if(draft.schemaVersion!=='1.0.0-draft.1')throw Error('Unexpected test draft schema');
 f.art.dimensions={width:.7,height:1.1};
 f.imageFit.pixelWidth=1200;f.imageFit.pixelHeight=1800;
 const replacement={...f.source,id:randomUUID(),name:'Second measured frame',model:{...f.source.model,sha256:'d'.repeat(64)},
  fit:{...f.source.fit,sourceSha256:'d'.repeat(64)}};
 const command={type:'attach-measured-frame' as const,placementId:f.placement.id,furnishingId:replacement.id,furnishingVersion:1 as const};
 const before=structuredClone(draft);
 const {candidate}=nativeMeasuredFrameAttachmentProposal(draft.candidate,command,replacement,f.imageFit);
 expect(f.draft).toEqual(before);
 const expected=structuredClone(before.candidate),value=expected.extensions![W] as unknown as WorkspaceFurnishings;
 value.version=10;value.furnishings=[replacement];
 value.frameAttachments=[{...f.row,furnishingId:replacement.id,modelSha256:replacement.model.sha256,imageFit:f.imageFit}];
 expect(candidate).toEqual(expected);
 expect(()=>nativeMeasuredFrameAttachmentProposal(draft.candidate,command,replacement,{...f.imageFit,sourceSha256:'e'.repeat(64)})).toThrow('FRAME_IMAGE_FIT_STALE');
 expect(f.draft).toEqual(before);

 const withoutFit=structuredClone(candidate);
 delete (withoutFit.extensions![W] as unknown as WorkspaceFurnishings).frameAttachments![0]!.imageFit;
 expect(requiresMeasuredFrameAttachmentFit(before.candidate,withoutFit)).toBe(true);
 expect(requiresMeasuredFrameAttachmentFit(before.candidate,before.candidate)).toBe(false);
 const query=vi.fn(async(sql:string)=>{void sql;return {rows:[],rowCount:0};}),client={query} as unknown as PoolClient;
 const session={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 f.service.readVersion.mockResolvedValue(replacement);
 f.service.checkDisplay.mockResolvedValue(replacement);
 const studio=new Studio({workspaceId:randomUUID()} as never,true,undefined,f.service as never);
 const row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:false};
 vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const match=etag(row.revision,row.metadata);
 const input={draft:{...draft,editVersion:draft.editVersion+1,candidate},requestId:randomUUID()};
 await expect(studio.put(client,session,row.id,{...input,draft:{...input.draft,candidate:withoutFit}},match)).rejects.toMatchObject({code:'FRAME_IMAGE_FIT_REQUIRED'});
 await expect(studio.put(client,session,row.id,input,etag(1,draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 f.service.frameImageFit.mockResolvedValueOnce({...f.imageFit,pixelHeight:1801});
 await expect(studio.put(client,session,row.id,input,match)).rejects.toMatchObject({code:'FRAME_IMAGE_FIT_STALE'});
 expect(query.mock.calls.filter(([sql])=>String(sql).startsWith('UPDATE exhibitions'))).toHaveLength(0);
 const written=await studio.put(client,session,row.id,input,match);
 expect(written).toEqual({revision:3,etag:etag(3,input.draft),draft:input.draft});
 expect(query.mock.calls.filter(([sql])=>String(sql).startsWith('UPDATE exhibitions'))).toHaveLength(1);
});
