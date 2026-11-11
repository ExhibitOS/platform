// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {fixtureURL,readOex,validateLifecycle} from '@exhibitos/spec';
import {PLAQUE_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import type {Session} from './auth.ts';
import {ApiError} from './auth.ts';
import {Studio,etag} from './studio.ts';
import {buildApp} from './app.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';

async function setup(){
 const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=source.exhibition;draft.exhibitionId=draft.candidate.id;
 const image=draft.candidate.artworks.find(a=>a.artworkType==='image')!;
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;(draft.candidate.artworks as typeof a[]).push(a);}
 const artworkPlacement=draft.candidate.placements[0]!,roomId=artworkPlacement.roomId;
 const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:true,export:true,commercial:true}};
 const old={id:crypto.randomUUID(),version:1,kind:'info-stand',name:'Original stand',rights,provenance:'Synthetic original',model:{mime:'model/gltf-binary',bytes:128,sha256:'a'.repeat(64)}};
 const replacement={...structuredClone(old),id:crypto.randomUUID(),name:'Replacement stand',model:{mime:'model/gltf-binary',bytes:136,sha256:'b'.repeat(64)}};
 const placement={id:crypto.randomUUID(),roomId,furnishingId:old.id,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1};
 const plaque={id:crypto.randomUUID(),roomId,source:{kind:'artwork',placementId:artworkPlacement.id},position:[0,1,0],rotation:[0,0,0,1],dimensions:{width:.15,height:.1},visible:true};
 draft.candidate.extensions={...draft.candidate.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:{version:3,furnishings:[old],placements:[placement]},[PLAQUE_NAMESPACE]:{version:1,plaques:[plaque]}} as never;
 const next=structuredClone(draft),ws=next.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {furnishings:typeof old[];placements:typeof placement[]},ps=next.candidate.extensions![PLAQUE_NAMESPACE] as unknown as {plaques:typeof plaque[]};
 ws.furnishings=[replacement];ws.placements[0]!.furnishingId=replacement.id;ws.placements[0]!.position=[.1,0,0];ps.plaques[0]!.position=[.1,1,0];next.editVersion++;
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session;
 const owner={workspaceId:crypto.randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:vi.fn(async()=>{})};
 const service={supportsPortalFinish:vi.fn(()=>false),supportsRoomVisual:vi.fn(()=>true),hasWriterLease:vi.fn(()=>true),authorize:vi.fn(async()=>{}),readVersion:vi.fn(async(_c:unknown,_s:unknown,id:string)=>structuredClone(id===old.id?old:replacement)),checkDisplay:vi.fn(async()=>structuredClone(replacement))};
 const studio=new Studio(owner as never,true,undefined,service as never),row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:true,studio_owner_user_id:session.userId};vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const query=vi.fn(async(sql:string)=>{void sql;return {rowCount:0,rows:[]};}),client={query} as unknown as PoolClient;
 return {draft,next,session,service,studio,query,client,match:etag(2,draft),input:{draft:next,requestId:crypto.randomUUID()}};
}
it('preflights and commits one bounded registered stand and plaque replacement through ordinary Save',async()=>{
 const f=await setup();expect(validateLifecycle(f.draft).valid).toBe(false);
 expect(await f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,f.input,f.match)).toMatchObject({valid:true});
 expect(f.query).not.toHaveBeenCalled();expect(f.service.checkDisplay).toHaveBeenCalledOnce();
 const saved=await f.studio.put(f.client,f.session,f.draft.exhibitionId,f.input,f.match);
 expect(saved.revision).toBe(3);expect(saved.draft).toEqual(f.next);
 const updates=f.query.mock.calls.filter(call=>String(call[0]).startsWith('UPDATE exhibitions'));
 expect(updates).toHaveLength(1);expect(f.service.checkDisplay).toHaveBeenCalledTimes(2);
});
it('advertises the replacement marker only for a live installed native owner with a room-visual writer',async()=>{
 const tenantId=crypto.randomUUID(),userId=crypto.randomUUID(),csrf='csrf',token='a'.repeat(43);
 const authRow={id:crypto.randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const query=vi.fn(async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[authRow],rowCount:1}:{rows:[],rowCount:0});
 const pool={connect:async()=>({query,release:()=>{}}),query} as never,blobs=new FileBlobStore('/synthetic-unused');
 const owner={workspaceId:crypto.randomUUID(),tenantId,principalId:userId,assertDatabase:async()=>{}};
 const service=new WorkspaceFurnishingIntakes(blobs,owner),writer=vi.spyOn(service,'hasWriterLease').mockReturnValue(true),visual=vi.spyOn(service,'supportsRoomVisual').mockReturnValue(true);
 vi.spyOn(service,'work').mockResolvedValue(false);let live=true;
 const app=buildApp({pool,blobs,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeOexWorkspace:owner as never,nativeExportWorkspace:owner,nativeBoundedEditing:true,workspaceFurnishing:service,runtimeAvailable:()=>live});
 const session=()=>app.inject({method:'GET',url:'/api/v1/auth/session',headers:{host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf}});
 try{
  expect((await session()).json().workspaceInfoStandReplacementProfile).toBe('workspace-info-stand-replacement-v1');
  live=false;expect((await session()).json().workspaceInfoStandReplacementProfile).toBeUndefined();live=true;
  writer.mockReturnValue(false);expect((await session()).json().workspaceInfoStandReplacementProfile).toBeUndefined();writer.mockReturnValue(true);
  visual.mockReturnValue(false);expect((await session()).json().workspaceInfoStandReplacementProfile).toBeUndefined();visual.mockReturnValue(true);
  vi.spyOn(service,'authorize').mockRejectedValue(new ApiError(403,'FORBIDDEN'));expect((await session()).json().workspaceInfoStandReplacementProfile).toBeUndefined();
 }finally{await app.close();}
});
it('refuses stale CAS, unrelated changes, missing live writer and failed current model authority before any write',async()=>{
 const f=await setup(),put=(draft=f.next,match=f.match)=>f.studio.put(f.client,f.session,f.draft.exhibitionId,{draft,requestId:crypto.randomUUID()},match);
 await expect(put(f.next,etag(1,f.draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 const other=structuredClone(f.next);other.candidate.title+=' unrelated';await expect(put(other)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 f.service.hasWriterLease.mockReturnValue(false);await expect(put()).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});f.service.hasWriterLease.mockReturnValue(true);
 f.service.checkDisplay.mockRejectedValueOnce(new ApiError(409,'ASSET_INTEGRITY'));await expect(put()).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 f.service.authorize.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));await expect(put()).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(f.query.mock.calls.filter(call=>/^(UPDATE|INSERT|DELETE)/.test(String(call[0])))).toHaveLength(0);
});
