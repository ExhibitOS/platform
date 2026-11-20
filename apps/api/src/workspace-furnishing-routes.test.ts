// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {ApiError} from './auth.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {etag,type Draft} from './studio.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('exposes owner-scoped furnishing endpoints only when the private service is supplied',async()=>{
 const csrf='valid-csrf',token='a'.repeat(43),authRow={id:id(1),user_id:id(2),tenant_id:id(3),role:'artist',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const query=vi.fn(async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[authRow],rowCount:1}:{rows:[],rowCount:0}),client={query,release:()=>{}},pool={connect:async()=>client,query} as never,blobs=new FileBlobStore('/synthetic-unused'),owner={workspaceId:id(4),tenantId:id(3),principalId:id(2),assertDatabase:async()=>{}},service=new WorkspaceFurnishingIntakes(blobs,owner);
 expect(()=>new WorkspaceFurnishingIntakes(blobs,owner,{writerFd:12,identity:{...owner,runtimeGeneration:id(5),rootDevice:'1',rootInode:'2',lockDevice:'1',lockInode:'3'},assertLive:async()=>{}})).toThrow('FURNISHING_LEASE_INVALID');
 const options={pool,blobs,auth:{mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:owner,workspaceFurnishing:service};expect(()=>buildApp(options)).toThrow('WORKSPACE_FURNISHING_CONFIGURATION');vi.spyOn(service,'hasWriterLease').mockReturnValue(true);vi.spyOn(service,'work').mockResolvedValue(false);const list=vi.spyOn(service,'listIntakes').mockResolvedValue({items:[],nextCursor:null});const app=buildApp(options);
 try{const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},session=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(session.statusCode).toBe(200);expect(session.json().workspaceFurnishingProfile).toBe('workspace-furnishing-intake-v1');expect(session.json().workspaceFurnishingStoolProfile).toBeUndefined();const supports=vi.spyOn(service,'supportsStool').mockReturnValue(true),stoolSession=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(stoolSession.json().workspaceFurnishingStoolProfile).toBe('workspace-furnishing-stool-v1');expect(stoolSession.json().workspaceFurnishingRoomVisualProfile).toBeUndefined();const room=vi.spyOn(service,'supportsRoomVisual').mockReturnValue(true),roomSession=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(roomSession.json().workspaceFurnishingRoomVisualProfile).toBe('workspace-furnishing-room-visual-v1');expect(roomSession.json().workspaceFurnishingStoolProfile).toBe('workspace-furnishing-stool-v1');const reusable=vi.spyOn(service,'supportsReusableFit').mockReturnValue(true),portal=vi.spyOn(service,'supportsPortalFinish').mockReturnValue(false);const noPortal=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(noPortal.json().workspacePortalRectangularFitProfile).toBeUndefined();portal.mockReturnValue(true);const rectangular=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(rectangular.json().workspacePortalRectangularFitProfile).toBe('rectangular-portal-v1');reusable.mockReturnValue(false);const noWriter=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(noWriter.json().workspacePortalRectangularFitProfile).toBeUndefined();portal.mockRestore();reusable.mockRestore();room.mockRestore();supports.mockRestore();const response=await app.inject({method:'GET',url:`/api/v1/tenants/${id(3)}/workspace/furnishing-intakes`,headers});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({items:[],nextCursor:null});expect(list).toHaveBeenCalledOnce();const check=vi.spyOn(service,'checkDisplay').mockResolvedValue({id:id(6),version:1} as never),authority=await app.inject({method:'GET',url:`/api/v1/tenants/${id(3)}/workspace/furnishings/${id(6)}/versions/1/display-check`,headers});expect(authority.statusCode).toBe(200);expect(authority.headers['cache-control']).toBe('no-store');expect(check).toHaveBeenCalledOnce();const invalid=await app.inject({method:'GET',url:`/api/v1/tenants/${id(3)}/workspace/furnishing-intakes?foreign=x`,headers});expect(invalid.statusCode).toBe(400);list.mockImplementationOnce(async()=>{vi.spyOn(owner,'assertDatabase').mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));return {items:[],nextCursor:null};});const lost=await app.inject({method:'GET',url:`/api/v1/tenants/${id(3)}/workspace/furnishing-intakes`,headers});expect(lost.statusCode).toBe(403);}finally{await app.close();}
 const appWithout=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});try{const response=await appWithout.inject({method:'GET',url:`/api/v1/tenants/${id(3)}/workspace/furnishing-intakes`,headers:{host:'127.0.0.1:13200'}});expect(response.statusCode).toBe(404);}finally{await appWithout.close();}
});
it('does not start the furnishing worker before the private runtime is ready',async()=>{
 const query=vi.fn(async()=>({rows:[],rowCount:0})),pool={query,connect:async()=>({query,release:()=>{}})} as never,blobs=new FileBlobStore('/synthetic-unused'),owner={workspaceId:id(4),tenantId:id(3),principalId:id(2),assertDatabase:async()=>{}},service=new WorkspaceFurnishingIntakes(blobs,owner);
 vi.spyOn(service,'hasWriterLease').mockReturnValue(true);const work=vi.spyOn(service,'work').mockResolvedValue(false);
 const app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:owner,workspaceFurnishing:service,runtimeAvailable:()=>false});
 try{await app.ready();expect(work).not.toHaveBeenCalled();}finally{await app.close();}
});


it('saves a light-only edit with a retained installed furnishing and preserves the saved head if its reference is invalid',async()=>{
 const csrf='fixture-csrf',authRow={id:id(1),user_id:id(2),tenant_id:id(3),role:'artist',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 const light=newLight(room.id,'point'); light.transform.position=[0,2,0]; draft.candidate.lights.push(light);
 // A public, previously installed furnishing with a synthetic room and placement.
 const furnishing={id:'a358b4d2-8f6c-5c0f-8421-a06e90624a94',version:1,kind:'info-stand',name:'Compact Caption Stand',
  model:{mime:'model/gltf-binary',bytes:13864,sha256:'ec9e424fe07eceeb4b422c0ed3dfa6981ac9f5dc335bd6ed32954d2c1a190752'},
  rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},
  provenance:'ExhibitOS default furnishings, compact-caption-stand v1.',
 } as const;
 const placement={id:id(5),roomId:room.id,furnishingId:furnishing.id,furnishingVersion:1,position:[1,0,0],yaw:0,scale:1};
 const reference={version:3,furnishings:[furnishing],placements:[placement]};
 draft.candidate.extensions={...draft.candidate.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:structuredClone(reference)};
 let revision=1,persisted:Draft=structuredClone(draft);
 const writes:string[]=[];
 const query=vi.fn(async(sql:string,params:unknown[]=[])=>{
  if(sql.includes('SELECT s.*,m.role'))return {rows:[authRow],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))
   return {rows:[{id:draft.exhibitionId,revision,metadata:structuredClone(persisted),studio_owner_user_id:id(2)}],rowCount:1};
  if(sql.startsWith('UPDATE exhibitions SET metadata=')){
   persisted=structuredClone(params[2] as Draft); revision=Number(params[3]);
  }
  if(/^(UPDATE|INSERT|DELETE)/.test(sql))writes.push(sql);
  return {rows:[],rowCount:0};
 });
 const pool={query,connect:async()=>({query,release:()=>{}})} as never;
 const blobs=new FileBlobStore('/synthetic-unused'),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const owner={workspaceId:id(4),tenantId:id(3),principalId:id(2),workspaceFurnishingStool:true as const,workspaceFurnishingRoomVisual:true as const,assertDatabase:async()=>{}};
 const service=new WorkspaceFurnishingIntakes(blobs,owner);
 vi.spyOn(service,'hasWriterLease').mockReturnValue(true);
 const app=buildApp({pool,blobs,auth,nativeExportWorkspace:owner,workspaceFurnishing:service,runtimeAvailable:()=>false});
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${'a'.repeat(43)}`,'x-csrf-token':csrf};
 const tenant=`/api/v1/tenants/${owner.tenantId}`,url=`${tenant}/studio/exhibitions/${draft.exhibitionId}`;
 const get=()=>app.inject({method:'GET',url,headers});
 const save=(next:Draft,match:string,requestId:string)=>app.inject({method:'PUT',url,headers:{...headers,'if-match':match},payload:{requestId,draft:next}});
 try{
  const stock=await app.inject({method:'GET',url:`${tenant}/workspace/furnishing-intakes`,headers});
  expect(stock.statusCode).toBe(200);
  expect(stock.json().items).not.toContainEqual(expect.objectContaining({id:furnishing.id}));
  const previous=await get();
  expect(previous.statusCode).toBe(200);
  const next=structuredClone(draft);
  next.candidate.lights.at(-1)!.intensity+=1; next.editVersion+=1;
  const saved=await save(next,etag(1,draft),id(6));
  expect(saved.statusCode,saved.body).toBe(200);
  expect(saved.json()).toEqual({revision:2,etag:etag(2,next),draft:next});
  const reopened=await get();
  expect(reopened.json()).toEqual(saved.json());
  expect(reopened.json().draft.candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE]).toEqual(reference);
  expect(query.mock.calls.some(([sql])=>sql.startsWith('SELECT descriptor,object_key FROM workspace_furnishing_versions'))).toBe(false);

  const invalid=structuredClone(next); invalid.editVersion+=1;
  const descriptor=(invalid.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings).furnishings[0]!;
  descriptor.model.sha256='0'.repeat(64);
  const beforeFailure=writes.length;
  const rejected=await save(invalid,etag(2,next),id(7));
  expect(rejected.statusCode,rejected.body).toBe(409);
  expect(rejected.json()).toMatchObject({code:'FURNISHING_VERSION_MISMATCH',message:`Furnishing ${furnishing.id} (version 1): The reference does not match the installed or registered version.`});
  expect(writes).toHaveLength(beforeFailure);
  expect((await get()).json()).toEqual(reopened.json());
 }finally{await app.close();}
});
