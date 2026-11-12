// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint} from './artifact-affine.js';
import {ensureRoomBaseLight,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,reflowRoomBaseLight,roomBaseLight,roomBaseLightRange,remapStudioLightDetails,setLightDetails,validateStudioLightDetails,type LightDetails} from './light-details.js';
import {applyLightObjectCommand} from './light-object.js';
const roomId='aaaaaaaa-0000-4000-8000-000000000001';
function fixture(){return {id:crypto.randomUUID(),revisionId:crypto.randomUUID(),rooms:[{id:roomId,name:'room',dimensions:{width:10,height:4,depth:8},transform:{position:[8,2,3],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]}}],lights:[],surfaces:[],openings:[],placements:[],artworks:[],extensions:{'org.example/intent':{value:'untouched'}}} as unknown as Exhibition;}
const fields=(d:Exhibition)=>{const {id,...light}=d.lights[0]!;return {id,light};};
const settings=(d:Exhibition)=>{const {lightId,...details}=lightDetailsFor(d)[0]!;void lightId;return details;};
it('new base is explicitauto in local room space with bounded farthest-corner coverage',()=>{
 const d=fixture(),before=structuredClone(d),next=ensureRoomBaseLight(d,roomId);expect(d).toEqual(before);expect(lightDetailsFor(next)[0]!.basePlacement).toBe('auto');
 expect(next.lights[0]!.transform.position).toEqual([0,3.6,0]);expect(artifactPoint(next.lights[0]!.transform.position,next.rooms[0]!.transform)).toEqual([8,5.6,3]);
 expect(lightDetailsFor(next)[0]!.range).toBeCloseTo(Math.hypot(5,4,3.6));expect(roomBaseLightRange({width:200,height:3,depth:200})).toBe(50);expect(validateStudioLightDetails(next).valid).toBe(true);
});
it('colour/brightness-only omitted intent preservesauto; off reflows without resetting intensity/RGB',()=>{
 let d=ensureRoomBaseLight(fixture(),roomId);const {basePlacement,...s}=settings(d);void basePlacement;
 d=setLightDetails(d,fields(d).id,{...fields(d).light,intensity:0,color:[.1,.2,.3]},s);expect(settings(d).basePlacement).toBe('auto');
 d.rooms[0]!.dimensions.height=6;const next=reflowRoomBaseLight(d,roomId);expect(next.lights[0]!.transform.position[1]).toBeCloseTo(5.4);expect(next.lights[0]!.intensity).toBe(0);expect(next.lights[0]!.color).toEqual([.1,.2,.3]);
});
it('spatial edit manualizes knownauto; explicit restore is atomic and preservesoff/colour; unknown never inferred',()=>{
 const auto=ensureRoomBaseLight(fixture(),roomId),{id,light}=fields(auto);
 const manual=setLightDetails(auto,id,{...light,transform:{...light.transform,position:[1,2,0]}},settings(auto));expect(settings(manual).basePlacement).toBe('manual');
 manual.rooms[0]!.dimensions.height=6;expect(reflowRoomBaseLight(manual,roomId)).toEqual(manual);
 const restored=applyLightObjectCommand(manual,{type:'set-room-base-light-placement',lightId:id,basePlacement:'auto'},{verifiedBaseline:manual}).candidate;expect(restored.lights[0]!.transform.position).toEqual([0,5.4,0]);expect(settings(restored).basePlacement).toBe('auto');
 const unknown=structuredClone(auto);delete (unknown.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.basePlacement;
 unknown.rooms[0]!.dimensions.height=8;expect(reflowRoomBaseLight(unknown,roomId)).toEqual(unknown);expect(settings(setLightDetails(unknown,id,{...fields(unknown).light,intensity:0},settings(unknown))).basePlacement).toBeUndefined();
 expect(restored.extensions!['org.example/intent']).toEqual(auto.extensions!['org.example/intent']);
});
it('removal never resurrects on room reflow and explicitensure is the only recreation',()=>{
 const d=ensureRoomBaseLight(fixture(),roomId),next=applyLightObjectCommand(d,{type:'remove-light-object',lightId:d.lights[0]!.id},{verifiedBaseline:d}).candidate;
 next.rooms[0]!.dimensions.height=7;expect(reflowRoomBaseLight(next,roomId).lights).toEqual([]);expect(roomBaseLight(next,roomId)).toBeUndefined();expect(ensureRoomBaseLight(next,roomId).lights).toHaveLength(1);
});
it('rejects foreign placement intent and retains closed enum validation',()=>{
 const d=ensureRoomBaseLight(fixture(),roomId),entry=(d.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;delete entry.purpose;expect(validateStudioLightDetails(d).valid).toBe(false);entry.purpose='room-base';(entry as unknown as Record<string,unknown>).basePlacement='inferred';expect(validateStudioLightDetails(d).valid).toBe(false);
});

it.each(['auto','manual','unknown','missing'])('whole-exhibition identity copy and typed OEX remap preserve %s intent without resurrection',kind=>{
 const d=kind==='missing'?fixture():ensureRoomBaseLight(fixture(),roomId);
 if(kind==='manual'||kind==='unknown'){const b=(d.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;if(kind==='manual')b.basePlacement='manual';else delete b.basePlacement;d.lights[0]!.transform.position=[1,2,1];}
 if(d.lights[0])d.lights[0].intensity=0;
 const copy=structuredClone(d);copy.id=crypto.randomUUID();copy.revisionId=crypto.randomUUID();
 expect(copy.lights).toEqual(d.lights);expect(copy.extensions).toEqual(d.extensions);
 const transported=JSON.parse(JSON.stringify(copy)) as Exhibition;expect(transported.lights).toEqual(d.lights);expect(transported.extensions).toEqual(d.extensions);
 const bindings=lightDetailsFor(transported);if(bindings.length){const newId=crypto.randomUUID(),remapped=remapStudioLightDetails({version:1,lights:bindings},new Map([[bindings[0]!.lightId.toLowerCase(),newId]]));expect(remapped.lights[0]).toEqual({...bindings[0],lightId:newId});}else expect(roomBaseLight(transported,roomId)).toBeUndefined();
});
it('automatic recipe cannot be forged by a stale raw candidate and object key order is not movement',()=>{
 const d=ensureRoomBaseLight(fixture(),roomId),{id,light}=fields(d);const reordered={scale:light.transform.scale,rotation:light.transform.rotation,position:light.transform.position};
 expect(settings(setLightDetails(d,id,{...light,transform:reordered},{fixture:'none'})).basePlacement).toBe('auto');
 const stale=structuredClone(d);stale.lights[0]!.transform.position[0]=1;expect(validateStudioLightDetails(stale).valid).toBe(false);stale.lights[0]!.transform.position[0]=0;(stale.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.range=1;expect(validateStudioLightDetails(stale).valid).toBe(false);
});
