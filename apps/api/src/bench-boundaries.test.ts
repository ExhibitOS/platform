// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {BENCH_NAMESPACE as N,PRESENTATION_NAMESPACE as P,applyBenchCommand,benchesFor,validateStudioBenches,presentationFor} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
function fixture(){
  const draft=newDraft(),d=draft.candidate,roomId=d.rooms[0]!.id,id=crypto.randomUUID(),viewpointId=crypto.randomUUID();
  draft.candidate=applyBenchCommand(d,{type:'add-bench',bench:{id,name:id,roomId,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,depth:.6,height:.45},material:{preset:'paint',color:'#FFFFFF',roughness:0,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId,position:[0,1.15,0],target:[0,1,-2],fov:50}});
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
