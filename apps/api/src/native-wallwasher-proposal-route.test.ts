// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256} from '@exhibitos/storage';
import {furnishingsFor,resolveFurnishing,validateFurnishings,applyLightObjectCommand,ceilingRailAttachmentMatrix,ceilingRailDerivedPose,lightAttachmentPose,WORKSPACE_FURNISHING_NAMESPACE,MUSEUM_TRACK_SPOT_FIXED64_PITCH} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {paintingWasherCandidate,lightId} from '../../../packages/studio-contract/test-fixtures/wallwasher.js';
import {newDraft} from '../../web/src/drafts/example.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';

it.each(['museum-wallwasher-rear-relief','recessed-downlight','museum-track-spot-fixed-64p1'] as const)('proposes %s through the existing owner route without persisting or accepting caller articulation',async catalogId=>{
 const fixture=paintingWasherCandidate(),draft=newDraft(),tenantId=randomUUID(),principalId=randomUUID(),csrf='test-csrf',token='a'.repeat(43),queries:string[]=[];
 draft.candidate=fixture.moved;draft.exhibitionId=fixture.moved.id;
 if(catalogId==='museum-track-spot-fixed-64p1'){
  const e=draft.candidate,room=e.rooms[0]!,surface=e.surfaces[0]!,pid=randomUUID(),fid=randomUUID(),source='aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42';
  room.dimensions.width=12;room.dimensions.depth=12;surface.dimensions={width:12,height:12};
  const attachment={placementId:pid,surfaceId:surface.id,anchor:[0,0] as [number,number],yaw:0,gap:0};
  e.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[{id:fid,version:1,kind:'ceiling-rail',name:'Rectangle',provenance:'Redistributable authored source',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256:source,bytes:268820},fit:{version:1,sourceSha256:source,sourceBytes:268820,geometry:{profile:'passive-ceiling-rail-v1',min:[-2.809499979019165,-.03500000014901161,-3.809499979019165],max:[2.809499979019165,0,3.809499979019165]}}}],placements:[{id:pid,roomId:room.id,furnishingId:fid,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
  const theta=MUSEUM_TRACK_SPOT_FIXED64_PITCH,emitter:[number,number,number]=[-2.2,3.965-.15+.0755*Math.sin(theta),-3.79-.0755*Math.cos(theta)],a={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...a,lightId}),{id:_,...fields}=e.lights[0]!;void _;
  draft.candidate=applyLightObjectCommand(e,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[emitter[0],emitter[1]+2.5*Math.sin(theta),emitter[2]-2.5*Math.cos(theta)]}},attachment:a}).candidate;
 }
 const revision=3,session={id:randomUUID(),user_id:principalId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{
  queries.push(sql);if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:principalId}],rowCount:1};
  return {rows:[],rowCount:0};
 },release:()=>{}};
 const owner={tenantId,principalId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}} as never;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const app=buildApp({pool:{connect:async()=>client} as unknown as Pool,auth,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>true});
 const binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId,requestId:randomUUID()};
 const request={...binding,type:'set-light-fixture',lightId,visual:{catalogId,catalogVersion:1,pose:{position:catalogId==='museum-track-spot-fixed-64p1'?[0,.15,.0755]:catalogId==='recessed-downlight'?[0,.008,0]:[0,.106,.05],yaw:0,scale:1}}};
 const post=(input:unknown)=>app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`,headers:{host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':etag(revision,draft)},payload:{expectedRevision:revision,request:input}});
 try{
  const before=structuredClone(draft),response=await post(request);expect(response.statusCode,response.body).toBe(200);
  const reply=response.json();expect(reply).toMatchObject({...binding,lightId});expect(validateFurnishings(reply.candidate).valid).toBe(true);
  const f=furnishingsFor(reply.candidate)!,resolved=resolveFurnishing(reply.candidate,f.bindings[0]!,f.assets[0]!);
  if(catalogId==='museum-wallwasher-rear-relief'){if(!('wallwasher' in resolved))throw Error('WASHER_RESULT_REQUIRED');expect(resolved.wallwasher.headPitch).toBe(-57.892880597116964*Math.PI/180);}else if(catalogId==='museum-track-spot-fixed-64p1'){expect(f.assets[0]).toMatchObject({catalogId,bytes:255228,sha256:'3cbe71cf0c6ed28cb99f16c34094b43dc1cb5b3f293406b2cec54e9fcbf0783a'});expect('wallwasher' in resolved&&resolved.wallwasher.headPitch).toBe(MUSEUM_TRACK_SPOT_FIXED64_PITCH);}else expect(f.assets[0]).toMatchObject({catalogId,bytes:86480,provenance:{recipe:'original-v1'}});expect(reply.candidate.lights).toEqual(JSON.parse(JSON.stringify(before.candidate.lights)));expect(draft).toEqual(before);
  expect((await post({...request,visual:{...request.visual,headPitch:0}})).statusCode).toBe(400);
  expect((await post({...request,visual:{...request.visual,pose:{...request.visual.pose,position:[0,20,0]}}})).statusCode).toBe(422);
  draft.candidate.lights[0]!.transform.position[1]-=.01;const corrupt=await post(request);expect(corrupt.statusCode,corrupt.body).toBe(409);expect(corrupt.json()).toMatchObject({code:'DRAFT_CORRUPT'});
  expect(queries.some(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 }finally{await app.close();}
});
