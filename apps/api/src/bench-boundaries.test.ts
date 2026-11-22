// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {expect,test,vi} from 'vitest';
import type {Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
import {BENCH_NAMESPACE as N,PRESENTATION_NAMESPACE as P,applyBenchCommand,applyFurnishingWalkingCollisionOverride,benchSolids,benchesFor,furnishingWalkingCollisionState,presentationFor,proposeWorkspaceDefaultSeats,validateStudioBenches,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
import {installedFurnishingDescriptors,installedWorkspaceBenchSeat} from './installed-workspace-furnishing.ts';
import {introducedInstalledStockBench,ordinaryInstalledBackedSeatDelta,ordinaryWorkspaceBenchSeatDelta} from './workspace-bench-seat-delta.ts';
function fixture(kind:'slab'|'backed'='slab'){
  const draft=newDraft(),d=draft.candidate,roomId=d.rooms[0]!.id,id=crypto.randomUUID(),viewpointId=crypto.randomUUID();
  draft.candidate=applyBenchCommand(d,{type:'add-bench',bench:{id,name:id,roomId,position:[0,0,0],yaw:0,kind,dimensions:{width:1.5,depth:.6,height:.45},material:{preset:'paint',color:'#FFFFFF',roughness:0,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId,position:[0,1.15,0],target:[0,1,-2],fov:50}});
  return draft;
}
test('draft/OEX admit exact namespace and reject dangling camera without dropping source metadata',()=>{
  const draft=fixture(),before=structuredClone(draft);expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
  const bad=structuredClone(draft);delete bad.candidate.extensions![P];expect(validateDraft(bad).valid).toBe(false);expect(()=>checkOexProfile(bad.candidate)).toThrow('OEX_PROFILE_INVALID');expect(draft).toEqual(before);
});
test('OEX and public projections remap bench/room/viewpoint consistently while retaining UUID-shaped names',()=>{
  const d=fixture().candidate,before=structuredClone(d),source=benchesFor(d)[0]!;
  for(const projected of [remapOex(d).exhibition,projectPublication(d,[],'2026-10-26T00:00:00.000Z').snapshot]){
    const b=benchesFor(projected)[0]!;expect(validateStudioBenches(projected).valid).toBe(true);expect(b.id).not.toBe(source.id);expect(b.roomId).toBe(projected.rooms[0]!.id);expect(b.viewpointId).toBe(presentationFor(projected).viewpoints[0]!.id);expect(b.name).toBe(source.id);expect(b.material).toEqual(source.material);
  }
  expect(d).toEqual(before);expect(Object.hasOwn(d.extensions!,N)).toBe(true);
});

test.each(['slab','backed'] as const)('keeps a %s workspace bench bound to its single visual through portable OEX',kind=>{
  const draft=fixture(kind),candidate=draft.candidate,bench=benchesFor(candidate)[0]!;
  const furnishingId=crypto.randomUUID(),placementId=crypto.randomUUID(),modelSha256='a'.repeat(64);
  const workspace:WorkspaceFurnishings={
    version:1,
    furnishings:[{id:furnishingId,version:1,kind:'bench',name:'Workspace bench',rights:{holder:'ExhibitOS',licenseId:'CC0-1.0',ownership:'authorized-licensee',creditLine:'ExhibitOS',permissions:{display:true,export:true,download:true,commercial:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',sha256:modelSha256,bytes:100}}],
    placements:[{id:placementId,roomId:bench.roomId,furnishingId,furnishingVersion:1,position:[...bench.position],yaw:bench.yaw,scale:1}],
  };
  candidate.extensions={...candidate.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:workspace as never};
  const attached=applyBenchCommand(candidate,{type:'set-bench',bench:{...bench,workspaceVisual:{placementId,modelSha256}}});
  const attachedDraft=structuredClone(draft);
  attachedDraft.candidate=attached;
  expect(ordinaryWorkspaceBenchSeatDelta(draft,attachedDraft)).toBe(kind==='backed');
  if(kind==='backed'){
    expect(benchSolids(attached).map(x=>x.vertices)).toEqual(benchSolids(candidate).map(x=>x.vertices));
    const changedHost=applyBenchCommand(candidate,{type:'set-bench',bench:{...bench,name:'Changed seat',workspaceVisual:{placementId,modelSha256}}});
    const changedDraft=structuredClone(draft);
    changedDraft.candidate=changedHost;
    expect(ordinaryWorkspaceBenchSeatDelta(draft,changedDraft)).toBe(false);
    expect(ordinaryWorkspaceBenchSeatDelta(attachedDraft,changedDraft)).toBe(false);
  }
  const moved=structuredClone(attached);
  (moved.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings).placements[0]!.position[0]+=.1;
  expect(validateStudioBenches(moved).valid).toBe(false);
  const {exhibition,idMap}=remapOex(attached,workspace),seat=benchesFor(exhibition)[0]!;
  const collision=structuredClone(workspace);
  collision.placements[0]!.id=bench.viewpointId;
  expect(()=>remapOex(attached,collision)).toThrow('OEX_PROFILE_INVALID');

  expect(seat.workspaceVisual).toEqual({placementId:idMap[placementId],modelSha256});
  expect(seat.viewpointId).toBe(idMap[bench.viewpointId]);
  expect(validateStudioBenches(exhibition).valid).toBe(true);
  const removed=applyBenchCommand(attached,{type:'remove-bench',benchId:bench.id});
  expect(removed.extensions?.[WORKSPACE_FURNISHING_NAMESPACE]).toEqual(workspace);
});

test('uses an admitted stock identity for a single new backed seat and preserves an authored link on repeat',async()=>{
 const draft=newDraft();
 if(draft.schemaVersion!=='1.0.0-draft.1')throw Error('Expected draft.1 fixture');
 const candidate=structuredClone(draft.candidate);
 const furnishing=installedFurnishingDescriptors().find(item=>installedWorkspaceBenchSeat(item))!;
 const defaults=installedWorkspaceBenchSeat(furnishing)!;
 const roomId=candidate.rooms[0]!.id,placementId=crypto.randomUUID();
 const target={placementId,benchId:crypto.randomUUID(),viewpointId:crypto.randomUUID()};
 const placement:WorkspaceFurnishings['placements'][number]={
  id:placementId,furnishingId:furnishing.id,furnishingVersion:1,roomId,position:[1,0,0],yaw:Math.PI,scale:1,
 };
 const workspace:WorkspaceFurnishings={version:1,furnishings:[furnishing],placements:[placement]};
 candidate.extensions={[WORKSPACE_FURNISHING_NAMESPACE]:workspace as never};
 expect(proposeWorkspaceDefaultSeats(candidate,[target]).additions).toEqual([]);
 const scaled=structuredClone(candidate);
 (scaled.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings).placements[0]!.scale=2;
 expect(proposeWorkspaceDefaultSeats(scaled,[target],defaults).additions).toEqual([]);
 const approved=proposeWorkspaceDefaultSeats(candidate,[target],defaults);
 const {bench,viewpoint}=approved.additions[0]!;
 expect(bench).toMatchObject({kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},position:placement.position,
  workspaceVisual:{placementId,modelSha256:furnishing.model.sha256,modelForward:'positive-z'}});
 expect(viewpoint.target[2]).toBeCloseTo(2);
 if(approved.candidate.schemaVersion!==draft.schemaVersion)throw Error('Proposal changed the schema version');
 const after={...draft,candidate:approved.candidate,editVersion:draft.editVersion+1};
 expect(ordinaryInstalledBackedSeatDelta(draft,after)).toEqual(furnishing);
 expect(ordinaryInstalledBackedSeatDelta({...draft,candidate},after)).toEqual(furnishing);
 const combined={...after,candidate:{...after.candidate,title:'Unrelated edit'}};
 expect(ordinaryInstalledBackedSeatDelta(draft,combined)).toBeUndefined();
 expect(introducedInstalledStockBench(draft,combined)).toEqual(furnishing);
 expect(introducedInstalledStockBench({...draft,candidate},combined)).toEqual(furnishing);
 expect(introducedInstalledStockBench(after,combined)).toBeUndefined();

 const explicit=applyFurnishingWalkingCollisionOverride(approved.candidate,{kind:'workspace',id:placementId},false);
 const repeated=proposeWorkspaceDefaultSeats(explicit,[target],defaults);
 expect(repeated.additions).toEqual([]);
 expect(repeated.candidate).toBe(explicit);
 expect(presentationFor(explicit).viewpoints).toEqual([viewpoint]);
 expect(furnishingWalkingCollisionState(explicit)).toEqual([{kind:'workspace',id:placementId,defaultEnabled:true,override:false}]);

 const session={userId:crypto.randomUUID(),tenantId:crypto.randomUUID()} as Session;
 const service={
  hasWriterLease:()=>true,
  installedStockBenchSeat:vi.fn(async()=>undefined as typeof defaults|undefined),
  readVersion:vi.fn(async()=>furnishing),
  checkDisplay:vi.fn(async()=>furnishing),
 };
 const studio=new Studio({principalId:session.userId,tenantId:session.tenantId} as never,true,undefined,service as never);
 vi.spyOn(studio,'access').mockResolvedValue({id:draft.exhibitionId,revision:1,metadata:draft,studio_owner_user_id:session.userId});
 const query=vi.fn<(sql:string)=>Promise<{rows:unknown[];rowCount:number}>>(async()=>({rows:[],rowCount:0}));
 const client={query} as unknown as PoolClient;
 const input={requestId:crypto.randomUUID(),draft:after};
 const match=etag(1,draft);
 await expect(studio.validateNativeViewport(client,session,draft.exhibitionId,input)).rejects.toMatchObject({code:'IF_MATCH_REQUIRED'});
 await expect(studio.put(client,session,draft.exhibitionId,input,match)).rejects.toMatchObject({code:'DEFAULT_CATALOGUE_INCOMPATIBLE'});
 await expect(studio.put(client,session,draft.exhibitionId,{...input,draft:combined},match)).rejects.toMatchObject({code:'DEFAULT_CATALOGUE_INCOMPATIBLE'});
 expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE exhibitions'))).toBe(false);
 service.installedStockBenchSeat.mockResolvedValue(defaults);
 await expect(studio.validateNativeViewport(client,session,draft.exhibitionId,input,match)).resolves.toEqual({valid:true});
 await expect(studio.put(client,session,draft.exhibitionId,{...input,draft:combined},match)).resolves.toMatchObject({revision:2,draft:combined});
 expect(query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE exhibitions'))).toHaveLength(1);

 if(explicit.schemaVersion!==draft.schemaVersion)throw Error('Collision override changed the schema version');
 const retained={...after,candidate:explicit};
 const edited={...retained,editVersion:retained.editVersion+1,candidate:{...explicit,title:'Retained stock seat edit'}};
 vi.mocked(studio.access).mockResolvedValue({...await studio.access(client,session,draft.exhibitionId),revision:2,metadata:retained});
 service.installedStockBenchSeat.mockClear().mockResolvedValue(undefined);
 await expect(studio.put(client,session,draft.exhibitionId,{requestId:crypto.randomUUID(),draft:edited},etag(2,retained)))
  .resolves.toMatchObject({revision:3,draft:edited});
 expect(service.installedStockBenchSeat).not.toHaveBeenCalled();
});
