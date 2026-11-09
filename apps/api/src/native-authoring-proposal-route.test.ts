// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256} from '@exhibitos/storage';
import {applyArchitecturalFinishCommand,applyPlaqueCommand} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';

it('proposes only a checked change to the current saved draft through the installed owner session',async()=>{
 const draft=newDraft(),tenantId=randomUUID(),userId=randomUUID(),csrf='test-csrf',token='a'.repeat(43);
 draft.candidate.surfaces=whiteCubeSurfaces(draft.candidate.rooms[0]!);
 const revision=3,match=etag(revision,draft),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{
  queries.push(sql);
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:userId}],rowCount:1};
  return {rows:[],rowCount:0};
 },release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}} as never;
 const app=buildApp({pool,auth,nativeOexWorkspace:owner,nativeBoundedEditing:true}),ordinary=buildApp({pool,auth});
 const url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`;
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 const binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()};
 const roomId=draft.candidate.rooms[0]!.id;
 const plaque={type:'add-plaque' as const,plaque:{id:randomUUID(),roomId,source:{kind:'room' as const},position:[0,1.5,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],dimensions:{width:.6,height:.3},visible:true},roomIntroductionText:'An introduction'};
 const wall={type:'set-wall-finish' as const,wall:{surfaceId:draft.candidate.surfaces.find(s=>s.type==='wall')!.id,depth:.12,preset:'painted-edge' as const,trimWidth:.04,baseboardHeight:.1,ceilingBand:true}};
 const payload={expectedRevision:revision,request:{...binding,...plaque}};
 const post=(value:unknown,override:Record<string,string>={})=>app.inject({method:'POST',url,headers:{...headers,...override},payload:value as object});
 const before=structuredClone(draft);
 try{
  const response=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect(response.json()).toMatchObject({nativeAuthoringProposalProfile:'saved-head-v1'});
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await post(payload,{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post({...payload,expectedRevision:revision-1})).statusCode).toBe(412);
  expect((await post(payload,{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  expect((await post({...payload,request:{...payload.request,principalId:randomUUID()}})).statusCode).toBe(403);
  expect((await post({...payload,candidate:draft.candidate})).statusCode).toBe(400);
  expect((await post({...payload,request:{...binding,...wall,wall:{...wall.wall,depth:200}}})).statusCode).toBe(422);
  const plaqueReply=await post(payload);
  expect(plaqueReply.statusCode,plaqueReply.body).toBe(200);
  expect(plaqueReply.headers.etag).toBe(match);
  expect(plaqueReply.json()).toEqual({...binding,plaqueId:plaque.plaque.id,candidate:applyPlaqueCommand(before.candidate,plaque)});
  const wallReply=await post({...payload,request:{...binding,...wall}});
  expect(wallReply.statusCode,wallReply.body).toBe(200);
  expect(wallReply.json()).toEqual({...binding,surfaceId:wall.wall.surfaceId,candidate:applyArchitecturalFinishCommand(before.candidate,wall)});
  expect(draft).toEqual(before);
  expect(queries.some(sql=>/^(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
 }finally{await app.close();await ordinary.close();}
});
