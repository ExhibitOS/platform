// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {ensureOrdinaryRoomBaseLight,ensureRoomBaseLight,ROOM_CEILING_FILL_DEFAULT_PROFILE,LIGHT_DETAILS_NAMESPACE as N,lightDetailsFor,resizeRoomEnvelope,setLightDetails,validateStudioLightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {applyGeometryCommand,whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
function fixture(){const draft=newDraft(),l=newLight(draft.candidate.rooms[0]!.id,'spot');l.transform.position=[0,2.4,1];draft.candidate.lights=[l];const {id,...light}=l;draft.candidate=setLightDetails(draft.candidate,id,light,{fixture:'spot-can',aim:{kind:'point',position:[0,1,0]},penumbra:.3,range:8});return draft;}
test('light details draft/OEX boundaries admit the known namespace and reject dangling bindings',()=>{
  const draft=fixture(),before=structuredClone(draft);expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();const invalid=structuredClone(draft);invalid.candidate.lights=[];expect(validateDraft(invalid).valid).toBe(false);expect(()=>checkOexProfile(invalid.candidate)).toThrow('OEX_PROFILE_INVALID');expect(draft).toEqual(before);
});
test('light details OEX/public projections remap only typed light identity and keep point/meaning/source intact',()=>{
  const d=fixture().candidate,before=structuredClone(d),binding=lightDetailsFor(d)[0]!;for(const projected of [remapOex(d).exhibition,projectPublication(d,[],'2026-10-26T00:00:00.000Z').snapshot]){const b=lightDetailsFor(projected)[0]!;expect(validateStudioLightDetails(projected).valid).toBe(true);expect(b.lightId).toBe(projected.lights[0]!.id);expect(b.lightId).not.toBe(binding.lightId);expect(b).toEqual({...binding,lightId:b.lightId});expect(projected.extensions![N]).toBeDefined();}expect(d).toEqual(before);
});

test.each(['auto','manual','unknown','removed'])('room base %s intent and off state survive actual OEX/public projection without inference',mode=>{
 const draft=newDraft();const source=ensureRoomBaseLight(draft.candidate,draft.candidate.rooms[0]!.id);source.lights[0]!.intensity=0;
 const entry=lightDetailsFor(source)[0]!;if(mode==='manual')entry.basePlacement='manual';if(mode==='unknown')delete entry.basePlacement;
 if(mode==='removed'){source.lights=[];source.extensions![N]={version:1,lights:[]};}else source.extensions![N]={version:1,lights:[entry]} as unknown as NonNullable<typeof source.extensions>[string];
 const before=structuredClone(source);expect(validateDraft({...draft,candidate:source}).valid).toBe(true);expect(()=>checkOexProfile(source)).not.toThrow();
 for(const candidate of [remapOex(source).exhibition,projectPublication(source,[],'2026-11-12T00:00:00.000Z').snapshot]){
  expect(validateStudioLightDetails(candidate).valid).toBe(true);if(mode==='removed'){expect(candidate.lights).toEqual([]);expect(lightDetailsFor(candidate)).toEqual([]);}else{expect(candidate.lights[0]!.intensity).toBe(0);expect(candidate.lights[0]!.transform).toEqual(source.lights[0]!.transform);expect(lightDetailsFor(candidate)[0]).toEqual({...entry,lightId:candidate.lights[0]!.id});}
 }
 expect(source).toEqual(before);
});

test.each(['auto','manual'])('tagged %s ceiling fill and interior geometry survive Save and OEX projection',mode=>{
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 draft.candidate.surfaces=whiteCubeSurfaces(room);
 let source=ensureRoomBaseLight(draft.candidate,room.id,undefined,0);
 const face=source.surfaces.find(surface=>surface.type===(mode==='auto'?'wall':'ceiling'))!;
 const interior={...structuredClone(face),id:crypto.randomUUID(),dimensions:{width:1,height:1},transform:{...face.transform,position:[0,1,0] as [number,number,number]}};
 source=applyGeometryCommand({present:source,past:[],future:[]},{type:'add-surface',surface:interior}).present;
 if(mode==='auto')source=resizeRoomEnvelope(source,room.id,{width:room.dimensions.width+1,height:room.dimensions.height+1,depth:room.dimensions.depth+1});
 expect(validateDraft({...draft,candidate:source}).valid).toBe(true);
 expect(()=>checkOexProfile(source)).not.toThrow();
 for(const projected of [remapOex(source).exhibition,projectPublication(source,[],'2026-11-16T00:00:00.000Z').snapshot]){
  expect(validateStudioLightDetails(projected).valid).toBe(true);
  expect(lightDetailsFor(projected)[0]).toMatchObject({basePlacement:mode,ceilingFill:{version:1,brightness:0}});
  expect(projected.lights[0]!.intensity).toBe(0);
  expect(projected.surfaces.some(surface=>surface.type===interior.type&&surface.transform.position[1]===1&&surface.dimensions.width===1)).toBe(true);
 }
});

test.each([true,false])('authored shadow intent %s survives draft validation and typed OEX/public projections',castsShadow=>{
 const draft=fixture(),source=draft.candidate,before=structuredClone(source),{id,...light}=source.lights[0]!;
 const {lightId,...settings}=lightDetailsFor(source)[0]!;void lightId;
 const changed=setLightDetails(source,id,{...light,castsShadow},settings);
 expect(validateDraft({...draft,candidate:changed}).valid).toBe(true);expect(()=>checkOexProfile(changed)).not.toThrow();
 for(const projected of [remapOex(changed).exhibition,projectPublication(changed,[],'2026-11-15T00:00:00.000Z').snapshot]){
  expect(projected.lights[0]!.castsShadow).toBe(castsShadow);expect(validateStudioLightDetails(projected).valid).toBe(true);
 }
 expect(source).toEqual(before);
});


test('explicit product default power survives saved JSON, OEX and public projection',()=>{
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 const source=ensureOrdinaryRoomBaseLight(draft.candidate,room.id,undefined,ROOM_CEILING_FILL_DEFAULT_PROFILE);
 const saved=JSON.parse(JSON.stringify(source)) as typeof source;
 const binding=lightDetailsFor(source)[0]!;
 expect(binding.ceilingFill).toEqual({version:1,brightness:.5,mode:'default'});
 expect(validateDraft({...draft,candidate:saved}).valid).toBe(true);
 expect(()=>checkOexProfile(saved)).not.toThrow();
 for(const candidate of [saved,remapOex(saved).exhibition,projectPublication(saved,[],'2026-11-19T00:00:00.000Z').snapshot]){
  expect(validateStudioLightDetails(candidate).valid).toBe(true);
  expect(candidate.lights[0]).toEqual({...source.lights[0],id:candidate.lights[0]!.id,roomId:candidate.rooms[0]!.id});
  expect(lightDetailsFor(candidate)[0]).toEqual({...binding,lightId:candidate.lights[0]!.id});
 }
});
