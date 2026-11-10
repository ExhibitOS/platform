// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {
 FURNISHING_WALKING_COLLISION_NAMESPACE as COLLISION,
 WORKSPACE_FURNISHING_NAMESPACE as WORKSPACE,
 applyBenchCommand,applyFurnishingWalkingCollisionOverride,benchesFor,furnishingWalkingCollisionState,reconcileFurnishingWalkingCollision,validateFurnishingWalkingCollision,
} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';

function fixture(){
 const draft=newDraft(),roomId=draft.candidate.rooms[0]!.id,id=randomUUID(),viewpointId=randomUUID();
 draft.candidate=applyBenchCommand(draft.candidate,{type:'add-bench',bench:{
  id,name:'Bench',roomId,position:[0,0,0],yaw:0,kind:'slab',
  dimensions:{width:1.5,depth:.6,height:.45},
  material:{preset:'wood',color:'#9B7653',roughness:.65,metalness:0},viewpointId,
 },viewpoint:{id:viewpointId,name:'Bench',roomId,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 return {draft,id};
}
test('preserves a disabled bench through OEX and public ID remapping',()=>{
 const {draft,id}=fixture(),candidate=draft.candidate;
 const state=()=>furnishingWalkingCollisionState(candidate).find(row=>row.kind==='bench');
 expect(state()).toEqual({kind:'bench',id,defaultEnabled:true});
 candidate.extensions![COLLISION]={version:1,overrides:[{kind:'bench',id,enabled:false}]};
 const original=structuredClone(candidate);
 expect(state()).toEqual({kind:'bench',id,defaultEnabled:true,override:false});
 expect(validateDraft(draft).valid).toBe(true);
 expect(()=>checkOexProfile(candidate)).not.toThrow();
 for(const snapshot of [remapOex(candidate).exhibition,projectPublication(candidate,[],'2026-11-10T00:00:00Z').snapshot]){
  const mapped=benchesFor(snapshot)[0]!.id;
  expect(mapped).not.toBe(id);
  expect(furnishingWalkingCollisionState(snapshot)).toContainEqual({kind:'bench',id:mapped,defaultEnabled:true,override:false});
 }
 expect(candidate).toEqual(original);
});

test('explicit defaults persist as author choices until explicitly cleared',()=>{
 const {draft,id}=fixture(),original=draft.candidate,target={kind:'bench',id:id.toUpperCase()} as const;
 expect(applyFurnishingWalkingCollisionOverride(original,target,null)).toBe(original);
 const explicit=applyFurnishingWalkingCollisionOverride(original,target,true);
 expect(explicit.extensions![COLLISION]).toEqual({version:1,overrides:[{kind:'bench',id,enabled:true}]});
 expect(furnishingWalkingCollisionState(explicit)).toContainEqual({kind:'bench',id,defaultEnabled:true,override:true});
 expect(applyFurnishingWalkingCollisionOverride(explicit,target,true)).toBe(explicit);
 const changed=applyFurnishingWalkingCollisionOverride(explicit,target,false);
 expect(furnishingWalkingCollisionState(changed)).toContainEqual({kind:'bench',id,defaultEnabled:true,override:false});
 expect(applyFurnishingWalkingCollisionOverride(changed,target,null)).toEqual(original);
 expect(()=>applyFurnishingWalkingCollisionOverride(original,{...target,id:randomUUID()},true)).toThrow('FURNISHING_WALKING_COLLISION_REFERENCE');
});

test('host removal prunes inherited overrides without concealing new invalid choices',()=>{
 const {draft,id}=fixture(),before=applyFurnishingWalkingCollisionOverride(draft.candidate,{kind:'bench',id},false);
 const removed=applyBenchCommand(before,{type:'remove-bench',benchId:id});
 expect(reconcileFurnishingWalkingCollision(before,removed).extensions?.[COLLISION]).toBeUndefined();
 removed.extensions![COLLISION]={version:1,overrides:[{kind:'bench',id,enabled:true}]};
 expect(reconcileFurnishingWalkingCollision(before,removed)).toBe(removed);
 expect(validateFurnishingWalkingCollision(removed).valid).toBe(false);
});

test.each([true,false])('bench attachment transfers explicit %s, with existing workspace choice taking precedence',enabled=>{
 const {draft,id}=fixture(),doc=draft.candidate,placementId=randomUUID(),furnishingId=randomUUID();
 const bench=benchesFor(doc)[0]!;
 const model={mime:'model/gltf-binary',bytes:415848,sha256:'6caca94361b540fb007c6fc605e519e436462eda43f2ec5f99da6a63108bfc60'};
 doc.extensions![WORKSPACE]={version:2,
  furnishings:[{id:furnishingId,version:1,kind:'stool',name:'Gallery stool',rights:{},provenance:'ExhibitOS',model}],
  placements:[{id:placementId,roomId:bench.roomId,furnishingId,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]};
 const seat={...bench,dimensions:{width:.38,depth:.38,height:.45}};
 const baseline=applyFurnishingWalkingCollisionOverride(doc,{kind:'bench',id},enabled);
 const attach=(source:typeof baseline)=>reconcileFurnishingWalkingCollision(source,applyBenchCommand(source,{
  type:'set-bench',bench:{...seat,workspaceVisual:{placementId,modelSha256:model.sha256}},
 }));
 const target={kind:'workspace',id:placementId} as const;
 const linked=attach(baseline);
 expect(linked.extensions![COLLISION]).toEqual({version:1,overrides:[{...target,enabled}]});
 expect(attach(applyFurnishingWalkingCollisionOverride(baseline,target,!enabled)).extensions![COLLISION])
  .toEqual({version:1,overrides:[{...target,enabled:!enabled}]});
 const unlinked=applyBenchCommand(linked,{type:'set-bench',bench});
 expect(reconcileFurnishingWalkingCollision(linked,unlinked).extensions![COLLISION]).toEqual(linked.extensions![COLLISION]);
 const withoutVisual=structuredClone(unlinked);
 delete withoutVisual.extensions![WORKSPACE];
 expect(reconcileFurnishingWalkingCollision(linked,withoutVisual).extensions![COLLISION])
  .toEqual({version:1,overrides:[{kind:'bench',id,enabled}]});
 const deleted=applyBenchCommand(withoutVisual,{type:'remove-bench',benchId:id});
 expect(reconcileFurnishingWalkingCollision(linked,deleted).extensions?.[COLLISION]).toBeUndefined();
});

test('rejects duplicate and stale target IDs instead of accepting a decorative toggle',()=>{
 const {draft,id}=fixture(),candidate=draft.candidate;
 for(const overrides of [
  [{kind:'bench',id,enabled:true},{kind:'bench',id:id.toUpperCase(),enabled:false}],
  [{kind:'bench',id:randomUUID(),enabled:false}],
  [{kind:'workspace',id,enabled:true}],
 ]){
  candidate.extensions![COLLISION]={version:1,overrides};
  expect(validateFurnishingWalkingCollision(candidate).valid).toBe(false);
  expect(validateDraft(draft).valid).toBe(false);
  expect(()=>checkOexProfile(candidate)).toThrow('OEX_PROFILE_INVALID');
 }
});
