// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect,vi} from 'vitest';
import type {Session} from './auth.ts';
import {etag} from './studio.ts';
import {buildApp} from './app.ts';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {FileBlobStore} from '@exhibitos/storage';
import {createHash} from 'node:crypto';
import {newDraft} from '../../web/src/drafts/example.ts';

it('acknowledges an already committed create and update after display rights expire while denying new writes',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-01T00:00:00Z'));
 let app:ReturnType<typeof buildApp>|undefined;
 try{
  const d=newDraft(),room=d.candidate.rooms[0]!,surface='50000000-0000-4000-8000-000000000021',id='11111111-1111-4111-8111-111111111111';
  d.candidate.surfaces.push({id:surface,roomId:room.id,type:'floor',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}});
  const material={id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',expiresAt:'2026-11-02T00:00:00Z',permissions:{display:true,download:true,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:10,height:10,colorSpace:'srgb'}}};
  d.candidate.extensions={'org.exhibitos.studio/workspace-materials':{version:1,materials:[material],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}};
  const session={tenantId:'10000000-0000-4000-8000-000000000001',userId:'10000000-0000-4000-8000-000000000002',role:'artist'} as Session;
  const token='a'.repeat(43),csrf='valid-csrf',authRow={id:crypto.randomUUID(),user_id:session.userId,tenant_id:session.tenantId,role:'artist',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
  const receipts=new Map<string,{payload_sha256:string;exhibition_id:string;response:unknown}>();let row:{id:string;revision:number;metadata:typeof d;studio_owner_user_id:string}|undefined;
  const query=vi.fn(async(sql:string,args:unknown[]=[]):Promise<{rowCount:number;rows:unknown[]}>=>{
   if(sql.includes('SELECT s.*,m.role'))return {rowCount:1,rows:[authRow]};
   if(sql.startsWith('SELECT * FROM studio_requests')){const found=receipts.get(args[2] as string);return {rowCount:found?1:0,rows:found?[found]:[]};}
   if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rowCount:row?1:0,rows:row?[row]:[]};
   if(sql.startsWith('SELECT 1 FROM exhibitions'))return {rowCount:row?1:0,rows:row?[row]:[]};
   if(sql.startsWith('INSERT INTO exhibitions')){row={id:args[1] as string,revision:1,metadata:args[2] as typeof d,studio_owner_user_id:args[3] as string};return {rowCount:1,rows:[]};}
   if(sql.startsWith('UPDATE exhibitions')){row={...row!,metadata:args[2] as typeof d,revision:args[3] as number};return {rowCount:1,rows:[]};}
   if(sql.startsWith('INSERT INTO studio_requests'))receipts.set(args[2] as string,{payload_sha256:args[3] as string,exhibition_id:args[4] as string,response:args[5]});
   return {rowCount:1,rows:[]};
  });
  const client={query,release:()=>{}},pool={connect:async()=>client,query} as never,blobs=new FileBlobStore('/synthetic-unused');
  const owner={workspaceId:crypto.randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:async()=>{}};
  const service=new WorkspaceMaterialIntakes(blobs,owner,()=>({valid:true,errors:[]}));
  vi.spyOn(service,'readVersion').mockResolvedValue(material as never);vi.spyOn(service,'work').mockResolvedValue(false);
  app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeExportWorkspace:owner,workspaceMaterial:service});
  const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},url=`/api/v1/tenants/${session.tenantId}/studio/exhibitions`;
  const create={draft:d,requestId:'10000000-0000-4000-8000-000000000003'};const created=await app.inject({method:'POST',url,headers,payload:create});expect(created.statusCode).toBe(201);
  const update={draft:d,requestId:'10000000-0000-4000-8000-000000000004'},match=etag(1,d),updateHeaders={...headers,'if-match':match};
  const updated=await app.inject({method:'PUT',url:`${url}/${d.exhibitionId}`,headers:updateHeaders,payload:update});expect(updated.statusCode).toBe(200);
  clock.mockReturnValue(Date.parse('2026-11-03T00:00:00Z'));
  const createReplay=await app.inject({method:'POST',url,headers,payload:create});expect(createReplay.statusCode).toBe(201);expect(createReplay.json()).toEqual(created.json());
  const updateReplay=await app.inject({method:'PUT',url:`${url}/${d.exhibitionId}`,headers:updateHeaders,payload:update});expect(updateReplay.statusCode).toBe(200);expect(updateReplay.json()).toEqual(updated.json());
  const changed=structuredClone(create);changed.draft.candidate.title='Changed';
  const conflict=await app.inject({method:'POST',url,headers,payload:changed});expect(conflict.statusCode).toBe(409);expect(conflict.json().code).toBe('REQUEST_CONFLICT');
  const fresh={draft:d,requestId:'10000000-0000-4000-8000-000000000005'};
  const newCreate=await app.inject({method:'POST',url,headers,payload:fresh});expect(newCreate.statusCode).toBe(403);expect(newCreate.json().code).toBe('DISPLAY_PERMISSION_REQUIRED');
  const denied=await app.inject({method:'PUT',url:`${url}/${d.exhibitionId}`,headers:{...headers,'if-match':etag(2,d)},payload:fresh});expect(denied.statusCode).toBe(403);expect(denied.json().code).toBe('DISPLAY_PERMISSION_REQUIRED');

 }finally{await app?.close();clock.mockRestore();}
});
