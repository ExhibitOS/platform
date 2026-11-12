// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {fixtureURL,readOex,validateLifecycle} from '@exhibitos/spec';
import {FURNISHING_WALKING_COLLISION_NAMESPACE as CN,BENCH_NAMESPACE as BN,PRESENTATION_NAMESPACE as PN,WORKSPACE_FURNISHING_NAMESPACE as WN,applyBenchCommand,applyWorkspaceBenchModelForward,validateStudioBenches,remapStudioBenches,WORKSPACE_BENCH_MODEL_FORWARD_PROFILE,type WorkspaceFurnishings,type StudioBenches} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {ordinaryWorkspaceBenchModelForwardDelta as delta} from './workspace-bench-model-forward-delta.ts';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {Studio,etag} from './studio.ts';
import {ApiError,type Session} from './auth.ts';

async function setup(){
 const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=source.exhibition;draft.exhibitionId=draft.candidate.id;
 const image=draft.candidate.artworks.find(a=>a.artworkType==='image')!;
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;(draft.candidate.artworks as typeof a[]).push(a);}
 const roomId=draft.candidate.rooms[0]!.id,hostId=crypto.randomUUID(),viewpointId=crypto.randomUUID(),placementId=crypto.randomUUID();
 const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:true,export:true,commercial:true}};
 const old={id:crypto.randomUUID(),version:1 as const,kind:'bench' as const,name:'Original bench',rights,provenance:'Synthetic original',model:{mime:'model/gltf-binary' as const,bytes:128,sha256:'a'.repeat(64)}};
 const target={...structuredClone(old),id:crypto.randomUUID(),name:'Replacement bench',model:{mime:'model/gltf-binary' as const,bytes:136,sha256:'b'.repeat(64)}};
 const placement={id:placementId,roomId,furnishingId:old.id,furnishingVersion:1 as const,position:[0,0,0] as [number,number,number],yaw:0,scale:1};
 draft.candidate.extensions={...draft.candidate.extensions,[WN]:{version:3,furnishings:[old],placements:[placement]}} as never;
 draft.candidate=applyBenchCommand(draft.candidate,{type:'add-bench',bench:{id:hostId,name:'Retained backed host',roomId,position:[0,0,0],yaw:0,kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},material:{preset:'paint',color:'#FFFFFF',roughness:.5,metalness:0},viewpointId,workspaceVisual:{placementId,modelSha256:old.model.sha256}},viewpoint:{id:viewpointId,name:'Retained eye',roomId,position:[0,1.15,0],target:[0,1,-2],fov:50}});
 draft.candidate.extensions![CN]={version:1,overrides:[{kind:'workspace',id:placementId,enabled:false}]} as never;
 const command={benchId:hostId,placementId,furnishingId:old.id,furnishingVersion:1 as const,modelSha256:old.model.sha256,expectedModelForward:'negative-z' as const,modelForward:'positive-z' as const};
 const next=structuredClone(draft);next.candidate=applyWorkspaceBenchModelForward(draft.candidate,command);next.editVersion++;next.updatedAt=new Date().toISOString();
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()} as Session;
 const owner={tenantId:session.tenantId,principalId:session.userId,assertDatabase:vi.fn(async()=>{})};
 const service={supportsPortalFinish:vi.fn(()=>false),supportsRoomVisual:vi.fn(()=>true),hasWriterLease:vi.fn(()=>true),authorize:vi.fn(async()=>{}),readVersion:vi.fn(async(_c:unknown,_s:unknown,id:string)=>structuredClone(id===old.id?old:target)),checkDisplay:vi.fn(async()=>structuredClone(old))};
 const studio=new Studio(owner as never,true,undefined,service as never),row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:true,studio_owner_user_id:session.userId};vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const query=vi.fn(async(sql:string)=>{void sql;return {rowCount:0,rows:[]};}),client={query} as unknown as PoolClient;
 return {draft,next,old,target,placement,command,session,owner,service,studio,query,client,match:etag(2,draft)};
}
type Setup=Awaited<ReturnType<typeof setup>>;
const workspace=(d:Setup['draft'])=>d.candidate.extensions![WN] as unknown as WorkspaceFurnishings;
const host=(d:Setup['draft'])=>(d.candidate.extensions![BN] as unknown as StudioBenches).benches[0]!;
it('declares only model-local forward and preserves source, host, placement, viewpoint and collision authority',async()=>{
 const f=await setup(),before=structuredClone(f.draft);expect(WORKSPACE_BENCH_MODEL_FORWARD_PROFILE).toBe('workspace-bench-model-forward-v1');expect(delta(f.draft,f.next)).toBe(true);expect(f.draft).toEqual(before);
 const expected=structuredClone(f.draft);host(expected).workspaceVisual!.modelForward='positive-z';expected.editVersion=f.next.editVersion;expected.updatedAt=f.next.updatedAt;expect(f.next).toEqual(expected);expect(validateStudioBenches(f.next.candidate).valid).toBe(true);
 const ids=new Map([[host(f.next).id,crypto.randomUUID()],[host(f.next).roomId,crypto.randomUUID()],[host(f.next).viewpointId,crypto.randomUUID()],[f.placement.id,crypto.randomUUID()]]);const mapped=remapStudioBenches(f.next.candidate.extensions![BN] as unknown as StudioBenches,ids);expect(mapped.benches[0]!.workspaceVisual!.modelForward).toBe('positive-z');
});
it('no-op preserves missing legacy field; positive-to-negative is explicit and stale expected declarations reject',async()=>{
 const f=await setup(),n=applyWorkspaceBenchModelForward(f.draft.candidate,{...f.command,modelForward:'negative-z'});const unchanged=structuredClone(f.draft);unchanged.candidate=n;expect(n).toEqual(f.draft.candidate);expect(host(unchanged).workspaceVisual).not.toHaveProperty('modelForward');
 expect(()=>applyWorkspaceBenchModelForward(f.draft.candidate,{...f.command,expectedModelForward:'positive-z'})).toThrow('BENCH_MODEL_FORWARD_STALE');
 const back=applyWorkspaceBenchModelForward(f.next.candidate,{...f.command,expectedModelForward:'positive-z',modelForward:'negative-z'});const backDraft=structuredClone(f.next);backDraft.candidate=back;expect(host(backDraft).workspaceVisual!.modelForward).toBe('negative-z');expect(delta(f.next,backDraft)).toBe(true);
 expect(delta(f.draft,unchanged)).toBe(false);
});
it.each(['host-id','host-size','host-name','host-material','host-kind','viewpoint','pose','scale','placement-id','wrong-digest','descriptor','collision','unrelated','unsupported','extra-field'] as const)('rejects declaration with %s changes',async kind=>{
 const f=await setup(),n=f.next,w=workspace(n),h=host(n);
 if(kind==='host-id')h.id=crypto.randomUUID();if(kind==='host-size')h.dimensions.height=.46;if(kind==='host-name')h.name+=' changed';if(kind==='host-material')h.material.roughness=.9;if(kind==='host-kind')h.kind='slab';
 if(kind==='viewpoint')(n.candidate.extensions![PN] as unknown as {viewpoints:{fov:number}[]}).viewpoints[0]!.fov=51;
 if(kind==='pose'){h.position[0]+=.1;w.placements[0]!.position[0]+=.1;}if(kind==='scale')w.placements[0]!.scale=.9;if(kind==='placement-id'){w.placements[0]!.id=crypto.randomUUID();h.workspaceVisual!.placementId=w.placements[0]!.id;}
 if(kind==='wrong-digest')h.workspaceVisual!.modelSha256='c'.repeat(64);if(kind==='descriptor')w.furnishings[0]!.name+=' changed';if(kind==='collision')(n.candidate.extensions![CN] as unknown as {overrides:{enabled:boolean}[]}).overrides[0]!.enabled=true;
 if(kind==='unrelated')n.candidate.title+=' changed';if(kind==='unsupported')Object.assign(h.workspaceVisual!,{modelForward:'sideways'});if(kind==='extra-field')Object.assign(h.workspaceVisual!,{rotation:Math.PI});expect(delta(f.draft,n)).toBe(false);
});
it('existing authenticated preflight and Save repeat live owner, registry, current bytes and IfMatch checks',async()=>{
 const f=await setup(),input={draft:f.next,requestId:crypto.randomUUID()};expect(validateLifecycle(f.draft).valid).toBe(false);
 expect(await f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,input,f.match)).toMatchObject({valid:true});expect(f.query).not.toHaveBeenCalled();expect(f.service.checkDisplay).toHaveBeenCalledWith(f.client,f.session,f.old.id,1);
 const preflightChecks=f.service.checkDisplay.mock.calls.length;
 const saved=await f.studio.put(f.client,f.session,f.draft.exhibitionId,input,f.match);expect(saved.revision).toBe(3);expect(saved.draft).toEqual(f.next);expect(f.service.checkDisplay.mock.calls.length).toBeGreaterThan(preflightChecks);expect(f.query.mock.calls.filter(c=>c[0].startsWith('UPDATE exhibitions'))).toHaveLength(1);
});
it.each(['stale','writer','rights','bytes','snapshot','owner','unrelated'] as const)('rejects %s before any save write',async barrier=>{
 const f=await setup();if(barrier==='writer')f.service.hasWriterLease.mockReturnValue(false);if(barrier==='rights')f.service.authorize.mockRejectedValue(new ApiError(403,'FORBIDDEN'));if(barrier==='bytes')f.service.checkDisplay.mockRejectedValue(new ApiError(409,'ASSET_INTEGRITY'));if(barrier==='snapshot')f.service.readVersion.mockResolvedValue(f.target);if(barrier==='owner')f.owner.assertDatabase.mockRejectedValue(new ApiError(403,'FORBIDDEN'));if(barrier==='unrelated')f.next.candidate.title+=' changed';
 await expect(f.studio.put(f.client,f.session,f.draft.exhibitionId,{draft:f.next,requestId:crypto.randomUUID()},barrier==='stale'?etag(1,f.draft):f.match)).rejects.toBeInstanceOf(ApiError);expect(f.query.mock.calls.filter(c=>/^(UPDATE|INSERT|DELETE)/.test(c[0]))).toHaveLength(0);
});
it('preflight rejects missing or stale IfMatch and a forged registered descriptor',async()=>{
 const f=await setup(),input={draft:f.next,requestId:crypto.randomUUID()};await expect(f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,input)).rejects.toMatchObject({code:'IF_MATCH_REQUIRED'});await expect(f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,input,etag(1,f.draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 f.service.readVersion.mockResolvedValue(f.target);await expect(f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,input,f.match)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
});

it('advertises the explicit model-forward marker only for a live installed native owner with a room-visual writer',async()=>{
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
  expect((await session()).json().workspaceBenchModelForwardProfile).toBe('workspace-bench-model-forward-v1');
  live=false;expect((await session()).json().workspaceBenchModelForwardProfile).toBeUndefined();live=true;
  writer.mockReturnValue(false);expect((await session()).json().workspaceBenchModelForwardProfile).toBeUndefined();writer.mockReturnValue(true);
  visual.mockReturnValue(false);expect((await session()).json().workspaceBenchModelForwardProfile).toBeUndefined();visual.mockReturnValue(true);
  vi.spyOn(service,'authorize').mockRejectedValue(new ApiError(403,'FORBIDDEN'));expect((await session()).json().workspaceBenchModelForwardProfile).toBeUndefined();
 }finally{await app.close();}
});



it.each(['unknown-forward','wrong-model','wrong-placement','wrong-furnishing','version','extra-field'] as const)('pure typed declaration rejects %s without mutating input',async kind=>{
 const f=await setup(),command=structuredClone(f.command),before=structuredClone(f.draft.candidate);
 if(kind==='unknown-forward')Object.assign(command,{modelForward:'sideways'});if(kind==='wrong-model')command.modelSha256='f'.repeat(64);if(kind==='wrong-placement')command.placementId=crypto.randomUUID();if(kind==='wrong-furnishing')command.furnishingId=crypto.randomUUID();if(kind==='version')Object.assign(command,{furnishingVersion:2});if(kind==='extra-field')Object.assign(command,{rotation:Math.PI});
 expect(()=>applyWorkspaceBenchModelForward(f.draft.candidate,command)).toThrow();expect(f.draft.candidate).toEqual(before);
});
