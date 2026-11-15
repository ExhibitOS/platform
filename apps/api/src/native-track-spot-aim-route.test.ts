// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256} from '@exhibitos/storage';
import {lightDetailsFor,validateFurnishings,resolveTrackSpotAiming} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {articulatedTrackSpotCandidate,lightId} from '../../../packages/studio-contract/test-fixtures/articulated-track-spot.js';
import {newDraft} from '../../web/src/drafts/example.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';
it('admits exact articulated entry and aim updates through the authenticated CAS owner route',async()=>{
 const fixture=articulatedTrackSpotCandidate(),draft=newDraft(),tenantId=randomUUID(),principalId=randomUUID(),csrf='test-csrf',token='a'.repeat(43),queries:string[]=[];
 draft.candidate=fixture.base;draft.exhibitionId=fixture.base.id;
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
 const request={...binding,...fixture.command};
 const post=(input:unknown,match=etag(revision,draft))=>app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`,headers:{host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match},payload:{expectedRevision:revision,request:input}});
 try{
  const before=structuredClone(draft),response=await post(request);expect(response.statusCode,response.body).toBe(200);
  const candidate=response.json().candidate;expect(validateFurnishings(candidate).valid).toBe(true);expect(resolveTrackSpotAiming(candidate,lightId).reachable).toBe(true);expect(lightDetailsFor(candidate)[0]!.trackAim).toEqual(fixture.trackAim);expect(draft).toEqual(before);
  for(const visual of [{...request.visual,trackAim:undefined},{...request.visual,headPitch:0},{...request.visual,trackAim:{...fixture.trackAim,profile:'unknown'}}])expect((await post({...request,visual})).statusCode).toBe(400);
  draft.candidate=candidate;const {id,...light}=candidate.lights[0]!;void id;
  const update={...binding,type:'set-light-object',lightId,light,settings:{fixture:'none',trackAim:{...fixture.trackAim,aim:{kind:'manual',yaw:0,pitch:-1}}}};
  const changed=await post(update);expect(changed.statusCode,changed.body).toBe(200);expect(lightDetailsFor(changed.json().candidate)[0]!.trackAim!.aim).toEqual(update.settings.trackAim.aim);
  const rejectedUpdate=await post({...update,settings:{...update.settings,trackAim:{...fixture.trackAim,aim:{kind:'manual',yaw:0,pitch:.1}}}});
  expect(rejectedUpdate.statusCode).toBe(422);
  expect(rejectedUpdate.json()).toMatchObject({code:'AUTHORING_PROPOSAL_INVALID',message:'TRACK_SPOT_AIM_OUTSIDE_ENVELOPE: Choose joint angles inside the verified source envelope.',fieldErrors:[]});
  draft.candidate=fixture.base;
  const rejectedEntry=await post({...request,visual:{...request.visual,trackAim:{...fixture.trackAim,aim:{kind:'manual',yaw:0,pitch:.1}}}});
  expect(rejectedEntry.statusCode).toBe(422);
  expect(rejectedEntry.json()).toMatchObject({code:'AUTHORING_PROPOSAL_INVALID',message:'TRACK_SPOT_AIM_OUTSIDE_ENVELOPE: Choose joint angles inside the verified source envelope.',fieldErrors:[]});
  const badPoint={...request,visual:{...request.visual,trackAim:{...fixture.trackAim,aim:{kind:'point',position:[0,10,0]}}}};
  const rejectedPoint=await post(badPoint);
  expect(rejectedPoint.statusCode).toBe(422);
  expect(rejectedPoint.json()).toMatchObject({code:'AUTHORING_PROPOSAL_INVALID',message:'TRACK_SPOT_AIM_INVALID_TARGET: Choose an existing artwork placement or point in the same room.'});
  const stale=await post(badPoint,etag(revision-1,draft));
  expect(stale.statusCode).toBe(412);
  expect(stale.json()).toMatchObject({code:'REMOTE_CONFLICT',message:'REMOTE_CONFLICT',fieldErrors:[]});
  expect(queries.some(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 }finally{await app.close();}
});
