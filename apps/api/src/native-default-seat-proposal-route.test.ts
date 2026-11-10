// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';

import {expect,test,vi} from 'vitest';
import {applyFurnishingWalkingCollisionOverride,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {buildApp} from './app.ts';
import {digest} from './auth.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';

test('native seat proposals require a session, CSRF and workspace ownership and do not persist',async()=>{
 const tenantId=randomUUID(),principalId=randomUUID(),outsider=randomUUID(),csrf=randomUUID();
 const ownerToken=randomBytes(32).toString('base64url'),outsiderToken=randomBytes(32).toString('base64url');
 const query=vi.fn(async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('SELECT s.*,m.role FROM auth_sessions')){
   const userId=params?.[0]===digest(ownerToken)?principalId:params?.[0]===digest(outsiderToken)?outsider:null;
   return {rows:userId?[{id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_token:csrf,csrf_hash:digest(csrf),expires_at:new Date('2099-01-01')}]:[]};
  }
  if(/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION ISOLATION LEVEL READ COMMITTED|SELECT pg_advisory_xact_lock(?:_shared)?\(8200[23]\))$/.test(sql))return {rows:[]};
  throw Error('Unexpected database query in proposal');
 });
 const pool={query:async()=>({rows:[]}),connect:async()=>({query,release:()=>{}})} as unknown as Pool;
 const owner={workspaceId:randomUUID(),tenantId,principalId,workspaceFurnishingStool:true as const,assertDatabase:vi.fn(async()=>{})};
 const blobs=new FileBlobStore("/unused-native-seat-proposal-test"),service=new WorkspaceFurnishingIntakes(blobs,owner);
 vi.spyOn(service,"hasWriterLease").mockReturnValue(true);
 const draft=newDraft(),stool={mime:'model/gltf-binary' as const,bytes:415848,sha256:'6caca94361b540fb007c6fc605e519e436462eda43f2ec5f99da6a63108bfc60'};
 const descriptor:WorkspaceFurnishings['furnishings'][number]={
  id:randomUUID(),version:1,kind:'stool',name:'Fixture stool',provenance:'Synthetic',
  rights:{holder:'Fixture',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Fixture',permissions:{display:true,export:true,download:true,commercial:true}},
  model:{mime:stool.mime,sha256:stool.sha256,bytes:stool.bytes},
 };
 const placementId=randomUUID(),roomId=draft.candidate.rooms[0]!.id;
 const workspace:WorkspaceFurnishings={version:2,furnishings:[descriptor],placements:[
  {id:placementId,roomId,furnishingId:descriptor.id,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1},
 ]};
 draft.candidate.extensions={...draft.candidate.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:workspace as never};
 const target={placementId,benchId:randomUUID(),viewpointId:randomUUID()},payload={draft,targets:[target]},before=structuredClone(payload);
 const read=vi.spyOn(service,'readVersion').mockResolvedValue(descriptor);
 const display=vi.spyOn(service,'checkDisplay').mockResolvedValue(descriptor);
 const origin='http://127.0.0.1:13200',host='127.0.0.1:13200';
 const app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'},nativeOexWorkspace:owner as never,workspaceFurnishing:service,runtimeAvailable:()=>false});
 const headers=(token?:string)=>({host,origin,...(token?{cookie:'exhibitos_local_session='+token}:{})});
 const post=(token?:string,csrfToken?:string)=>app.inject({
  method:'POST',url:`/api/v1/tenants/${tenantId}/studio/native-default-seat-proposal`,payload,
  headers:{...headers(token),...(csrfToken?{'x-csrf-token':csrfToken}:{})},
 });
 try{
  const session=(token:string)=>app.inject({method:'GET',url:'/api/v1/auth/session',headers:headers(token)});
  expect((await session(ownerToken)).json()).toMatchObject({
   nativeDefaultSeatProposalProfile:'default-seat-proposal-v1',
   nativeFurnishingWalkingCollisionProfile:'furnishing-walking-collision-v1',
  });
  const outsiderSession=(await session(outsiderToken)).json();
  expect(outsiderSession).not.toHaveProperty('nativeDefaultSeatProposalProfile');
  expect(outsiderSession).not.toHaveProperty('nativeFurnishingWalkingCollisionProfile');
  expect((await post()).json()).toMatchObject({code:'AUTH_REQUIRED'});
  expect((await post(ownerToken)).json()).toMatchObject({code:'CSRF_REJECTED'});
  expect((await post(outsiderToken,csrf)).json()).toMatchObject({code:'FORBIDDEN'});
  expect(read).not.toHaveBeenCalled();
  expect(display).not.toHaveBeenCalled();

  const response=await post(ownerToken,csrf);
  expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toEqual({additions:[{
   placementId,bench:expect.objectContaining({id:target.benchId,viewpointId:target.viewpointId,workspaceVisual:{placementId,modelSha256:stool.sha256}}),
   viewpoint:expect.objectContaining({id:target.viewpointId}),
  }]});
  expect(display).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({userId:principalId}),descriptor.id,1);
  read.mockResolvedValueOnce({...descriptor,name:'Different registered version'});
  expect((await post(ownerToken,csrf)).json()).toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
  const collisionDraft={...draft,candidate:applyFurnishingWalkingCollisionOverride(draft.candidate,{kind:'workspace',id:placementId},true)};
  const evaluate=(token:string,csrfToken?:string)=>app.inject({
   method:'POST',url:`/api/v1/tenants/${tenantId}/studio/native-furnishing-walking-collision-evaluation`,
   payload:{draft:collisionDraft},headers:{...headers(token),...(csrfToken?{'x-csrf-token':csrfToken}:{})},
  });
  expect((await evaluate(outsiderToken,csrf)).json()).toMatchObject({code:'FORBIDDEN'});
  expect((await evaluate(ownerToken)).json()).toMatchObject({code:'CSRF_REJECTED'});
  expect((await evaluate(ownerToken,csrf)).json()).toEqual({
   targets:[{kind:'workspace',id:placementId,defaultEnabled:true,override:true}],
  });
  const propose=(enabled:boolean|null,id=placementId)=>app.inject({
   method:'POST',url:`/api/v1/tenants/${tenantId}/studio/native-furnishing-walking-collision-proposal`,
   payload:{draft:collisionDraft,target:{kind:'workspace',id},enabled},
   headers:{...headers(ownerToken),'x-csrf-token':csrf},
  });
  expect((await propose(true)).json()).toEqual({changed:false,candidate:collisionDraft.candidate});
  expect((await propose(null)).json()).toEqual({changed:true,candidate:draft.candidate});
  expect((await propose(false,randomUUID())).json()).toMatchObject({code:'FURNISHING_WALKING_COLLISION_INVALID'});
  expect(payload).toEqual(before);
  expect(query.mock.calls.some(([sql])=>/\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
 }finally{await app.close();}
});
