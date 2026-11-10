// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {
 FURNISHING_WALKING_COLLISION_NAMESPACE as COLLISION,
 applyBenchCommand,benchesFor,furnishingWalkingCollisionState,validateFurnishingWalkingCollision,
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
