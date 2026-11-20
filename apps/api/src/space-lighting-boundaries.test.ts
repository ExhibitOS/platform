import {expect,test} from 'vitest';
import {SPACE_LIGHTING_NAMESPACE as N,ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE,applyLightObjectCommand,ensureOrdinaryRoomBaseLight,lightDetailsFor,setSpaceLighting,spaceLightingFor,validateArchitecture} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
test('space lighting is admitted at draft/OEX/public projection and preserves absence versus explicit zero',()=>{
 const draft=newDraft(),legacy=structuredClone(draft.candidate);
 expect(spaceLightingFor(remapOex(legacy).exhibition)).toBeUndefined();
 expect(spaceLightingFor(projectPublication(legacy,[],'2026-10-26T00:00:00.000Z').snapshot)).toBeUndefined();
 draft.candidate=setSpaceLighting(draft.candidate,{version:1,baselineIntensity:0,reflectionIntensity:0});const before=structuredClone(draft);
 expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
 for(const d of [remapOex(draft.candidate).exhibition,projectPublication(draft.candidate,[],'2026-10-26T00:00:00.000Z').snapshot])expect(spaceLightingFor(d)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0});
 expect(draft).toEqual(before);expect(legacy.extensions?.[N]).toBeUndefined();
});
test('invalid known space controls fail the existing common architecture boundary without coercion',()=>{
 const draft=newDraft();draft.candidate.extensions={...draft.candidate.extensions,[N]:{version:1,baselineIntensity:2,reflectionIntensity:0}};
 expect(validateArchitecture(draft.candidate).valid).toBe(false);expect(validateDraft(draft).valid).toBe(false);expect(()=>checkOexProfile(draft.candidate)).toThrow('OEX_PROFILE_INVALID');
});

test('retains room-local policy through manual/off and public/OEX remap',()=>{
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 room.dimensions={width:4,depth:5,height:2.7};
 const other={...structuredClone(room),id:crypto.randomUUID(),dimensions:{width:8,depth:6,height:4.2}};
 draft.candidate.rooms.push(other);
 draft.candidate=ensureOrdinaryRoomBaseLight(draft.candidate,room.id,undefined,ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE);
 draft.candidate=ensureOrdinaryRoomBaseLight(draft.candidate,other.id,undefined,ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE);
 expect(draft.candidate.lights[0]).toMatchObject({intensity:128.17889508773317,dimensions:{width:3.2,height:4}});
 expect(draft.candidate.lights[1]).toMatchObject({intensity:310.8614451658536,dimensions:{width:6.4,height:6*.8}});
 const first=draft.candidate.lights[0]!,second=draft.candidate.lights[1]!;
 draft.candidate=applyLightObjectCommand(draft.candidate,{type:'set-room-base-light-placement',lightId:first.id,basePlacement:'manual'}).candidate;
 draft.candidate=applyLightObjectCommand(draft.candidate,{type:'set-room-ceiling-fill-brightness',lightId:second.id,brightness:0}).candidate;
 expect(draft.candidate.lights[0]).toEqual(first);
 const detail=lightDetailsFor(draft.candidate);
 expect(detail[0]).toMatchObject({basePlacement:'manual',ceilingFill:{brightness:.5,mode:'default'}});
 expect(detail[1]).toMatchObject({basePlacement:'auto',ceilingFill:{version:1,brightness:0}});
 expect(draft.candidate.lights[1]!.intensity).toBe(0);
 expect(validateDraft(draft).valid).toBe(true);
 expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
 for(const candidate of [remapOex(draft.candidate).exhibition,projectPublication(draft.candidate,[],'2026-11-21T00:00:00.000Z').snapshot]){
  expect(spaceLightingFor(candidate)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0,mode:'room-local'});
  expect(candidate.lights.map(light=>light.intensity)).toEqual([first.intensity,0]);
  expect(lightDetailsFor(candidate).map(({basePlacement,ceilingFill})=>({basePlacement,ceilingFill})))
   .toEqual(detail.map(({basePlacement,ceilingFill})=>({basePlacement,ceilingFill})));
 }
});
