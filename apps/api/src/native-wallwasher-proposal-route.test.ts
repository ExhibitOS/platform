// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256} from '@exhibitos/storage';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {paintingWasherCandidate,lightId} from '../../../packages/studio-contract/test-fixtures/wallwasher.js';
import {newDraft} from '../../web/src/drafts/example.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';

it('proposes the checked mounted painting fixture through the existing owner route without persisting or accepting caller articulation',async()=>{
 const fixture=paintingWasherCandidate(),draft=newDraft(),tenantId=randomUUID(),principalId=randomUUID(),csrf='test-csrf',token='a'.repeat(43),queries:string[]=[];
 draft.candidate=fixture.moved;draft.exhibitionId=fixture.moved.id;
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
 const request={...binding,type:'set-light-fixture',lightId,visual:{catalogId:'museum-wallwasher-rear-relief',catalogVersion:1,pose:{position:[0,.106,.05],yaw:0,scale:1}}};
 const post=(input:unknown)=>app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`,headers:{host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':etag(revision,draft)},payload:{expectedRevision:revision,request:input}});
 try{
  const before=structuredClone(draft),response=await post(request);expect(response.statusCode,response.body).toBe(200);
  const reply=response.json();expect(reply).toMatchObject({...binding,lightId});expect(validateFurnishings(reply.candidate).valid).toBe(true);
  const f=furnishingsFor(reply.candidate)!,resolved=resolveFurnishing(reply.candidate,f.bindings[0]!,f.assets[0]!);
  if(!('wallwasher' in resolved))throw Error('WASHER_RESULT_REQUIRED');expect(resolved.wallwasher.headPitch).toBe(-57.892880597116964*Math.PI/180);expect(reply.candidate.lights).toEqual(JSON.parse(JSON.stringify(before.candidate.lights)));expect(draft).toEqual(before);
  expect((await post({...request,visual:{...request.visual,headPitch:0}})).statusCode).toBe(400);
  expect((await post({...request,visual:{...request.visual,pose:{...request.visual.pose,scale:2}}})).statusCode).toBe(422);
  draft.candidate.lights[0]!.transform.position[1]-=.01;const corrupt=await post(request);expect(corrupt.statusCode,corrupt.body).toBe(409);expect(corrupt.json()).toMatchObject({code:'DRAFT_CORRUPT'});
  expect(queries.some(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 }finally{await app.close();}
});
