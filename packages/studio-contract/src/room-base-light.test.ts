// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint} from './artifact-affine.js';
import {addRoomSupplementalCeilingFill,ensureOrdinaryRoomBaseLight,ensureRoomBaseLight,hasDefaultRoomLighting,ROOM_CEILING_FILL_DEFAULT_PROFILE,ROOM_CEILING_FILL_PROFILE,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,reflowRoomBaseLight,roomBaseLight,roomBaseLightRange,remapStudioLightDetails,setLightDetails,validateStudioLightDetails,type LightDetails} from './light-details.js';
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

it('tagged ceiling fill derives canonical power and reflows without resetting brightness',()=>{
 const source=fixture();
 const auto=ensureRoomBaseLight(source,roomId,undefined,.5);
 const light=auto.lights[0]!;
 expect(light).toMatchObject({type:'area',unit:'lumen',castsShadow:false,dimensions:{width:8,height:6.4}});
 expect(light.transform.position).toEqual([0,3.98,0]);
 expect(artifactPoint([0,0,-1],light.transform)[1]).toBeCloseTo(2.98);
 expect(settings(auto).ceilingFill).toEqual({version:1,brightness:.5});
 expect(light.intensity).toBeGreaterThan(0);
 const stale=structuredClone(auto);stale.rooms[0]!.dimensions={width:8,height:5,depth:12};
 expect(validateStudioLightDetails(stale).valid).toBe(false);
 const reflowed=reflowRoomBaseLight(stale,roomId);
 expect(reflowed.lights[0]!.dimensions).toEqual({width:6.4,height:12*.8});
 expect(reflowed.lights[0]!.transform.position).toEqual([0,4.98,0]);
 expect(reflowed.lights[0]!.intensity).not.toEqual(light.intensity);
 expect(settings(reflowed).ceilingFill).toEqual(settings(auto).ceilingFill);
 expect(source.lights).toEqual([]);
});

it('explicit default is five times the legacy .5 emitter through refit and separate from a deliberate .5 override',()=>{
 const source=fixture(),id=crypto.randomUUID();
 const legacy=ensureOrdinaryRoomBaseLight(source,roomId,id,ROOM_CEILING_FILL_PROFILE);
 const marked=ensureOrdinaryRoomBaseLight(source,roomId,id,ROOM_CEILING_FILL_DEFAULT_PROFILE);
 const chooseDefault={type:'set-room-ceiling-fill-brightness',lightId:id,brightness:.5,mode:'default'} as const;
 expect(marked.lights).toEqual([{...legacy.lights[0],intensity:5*legacy.lights[0]!.intensity}]);
 expect(settings(marked).ceilingFill).toEqual({version:1,brightness:.5,mode:'default'});
 expect(hasDefaultRoomLighting(legacy)).toBe(false);
 expect(hasDefaultRoomLighting(marked)).toBe(true);
 expect(applyLightObjectCommand(legacy,chooseDefault).candidate).toEqual(marked);
 expect(applyLightObjectCommand(marked,chooseDefault).candidate).toEqual(marked);
 expect(applyLightObjectCommand(marked,{type:chooseDefault.type,lightId:id,brightness:.5}).candidate).toEqual(legacy);
 expect(()=>applyLightObjectCommand(marked,{...chooseDefault,brightness:.4})).toThrow('ROOM_CEILING_FILL_BRIGHTNESS');
 expect(ensureOrdinaryRoomBaseLight(legacy,roomId,undefined,ROOM_CEILING_FILL_DEFAULT_PROFILE)).toBe(legacy);
 const editRoom=(doc:Exhibition)=>({...doc,rooms:[{...doc.rooms[0]!,dimensions:{width:8,height:5,depth:12}}]});
 const refit=reflowRoomBaseLight(editRoom(marked),roomId);
 const legacyRefit=reflowRoomBaseLight(editRoom(legacy),roomId);
 expect(refit.lights).toEqual([{...legacyRefit.lights[0],intensity:5*legacyRefit.lights[0]!.intensity}]);
 const manual=applyLightObjectCommand(marked,{type:'set-room-base-light-placement',lightId:id,basePlacement:'manual'}).candidate;
 expect(hasDefaultRoomLighting(manual)).toBe(false);
 const manuallyResized=editRoom(manual);
 expect(reflowRoomBaseLight(manuallyResized,roomId)).toEqual(manuallyResized);
 expect(applyLightObjectCommand(manuallyResized,{type:'set-room-base-light-placement',lightId:id,basePlacement:'auto'}).candidate).toEqual(refit);
});

it('tagged manual pose survives resize and zero brightness survives return to auto',()=>{
 const auto=ensureRoomBaseLight(fixture(),roomId,undefined,.5),{id,light}=fields(auto);
 const manual=setLightDetails(auto,id,{...light,transform:{...light.transform,position:[1,3,0]}},settings(auto));
 expect(settings(manual).basePlacement).toBe('manual');
 manual.rooms[0]!.dimensions.height=6;
 expect(reflowRoomBaseLight(manual,roomId)).toBe(manual);
 const off=applyLightObjectCommand(manual,{type:'set-room-ceiling-fill-brightness',lightId:id,brightness:0}).candidate;
 expect(off.lights[0]!.transform.position).toEqual([1,3,0]);
 expect(off.lights[0]!.intensity).toBe(0);
 const restored=applyLightObjectCommand(off,{type:'set-room-base-light-placement',lightId:id,basePlacement:'auto'}).candidate;
 expect(restored.lights[0]!.transform.position).toEqual([0,5.98,0]);
 expect(restored.lights[0]!.intensity).toBe(0);
 expect(settings(restored).ceilingFill).toEqual({version:1,brightness:0});
});

it('rejects ambiguous ceiling geometry and refuses brightness commands on legacy point lights',()=>{
 const source=fixture();
 const ceiling:Exhibition['surfaces'][number]={id:crypto.randomUUID(),roomId,type:'ceiling',dimensions:{width:10,height:8},transform:{position:[0,4,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}};
 source.surfaces.push(ceiling,{...ceiling,id:crypto.randomUUID()});
 expect(()=>ensureRoomBaseLight(source,roomId,undefined,1)).toThrow('ROOM_CEILING_FILL_GEOMETRY');
 const legacy=ensureRoomBaseLight(source,roomId);
 expect(()=>applyLightObjectCommand(legacy,{type:'set-room-ceiling-fill-brightness',lightId:legacy.lights[0]!.id,brightness:0})).toThrow('LIGHT_DETAILS_CEILING_FILL');
});

it('adds and refits one canonical supplemental fill while preserving the unmarked base point',()=>{
 const auto=ensureRoomBaseLight(fixture(),roomId),legacy=structuredClone(auto);
 const base=legacy.lights[0]!;
 const binding=(legacy.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;
 delete binding.basePlacement;
 binding.range=10;
 const untouched=structuredClone(legacy),lightId=crypto.randomUUID();
 const filled=addRoomSupplementalCeilingFill(legacy,roomId,base.id,lightId);
 expect(legacy).toEqual(untouched);
 expect(filled.lights[0]).toEqual(base);
 expect(lightDetailsFor(filled)).toEqual([binding,{lightId,fixture:'none',purpose:'room-supplemental-fill',basePlacement:'auto',ceilingFill:{version:1,brightness:0.5}}]);
 expect(filled.lights[1]).toMatchObject({id:lightId,type:'area',unit:'lumen',castsShadow:false});
 expect(roomBaseLight(filled,roomId)).toEqual(base);
 expect(()=>addRoomSupplementalCeilingFill(auto,roomId,base.id,lightId)).toThrow('LIGHT_DETAILS_CEILING_FILL');
 expect(()=>addRoomSupplementalCeilingFill(legacy,roomId,crypto.randomUUID(),lightId)).toThrow('LIGHT_DETAILS_CEILING_FILL');
 expect(()=>addRoomSupplementalCeilingFill(legacy,roomId,base.id,base.id)).toThrow('LIGHT_DETAILS_CEILING_FILL');
 expect(()=>addRoomSupplementalCeilingFill(filled,roomId,base.id,crypto.randomUUID())).toThrow('LIGHT_DETAILS_CEILING_FILL');
 const invalid=structuredClone(filled),details=(invalid.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights;
 details.shift();
 expect(validateStudioLightDetails(invalid).valid).toBe(false);
 const malformed=structuredClone(filled);
 malformed.lights[1]!.intensity+=1;
 expect(validateStudioLightDetails(malformed).valid).toBe(false);
 const duplicate=structuredClone(filled),duplicateId=crypto.randomUUID();
 duplicate.lights.push({...duplicate.lights[1]!,id:duplicateId});
 (duplicate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights.push({...lightDetailsFor(filled)[1]!,lightId:duplicateId});
 expect(validateStudioLightDetails(duplicate).valid).toBe(false);
 filled.rooms[0]!.dimensions.height=5;
 const resized=reflowRoomBaseLight(filled,roomId);
 expect(resized.lights[0]).toEqual(base);
 expect(lightDetailsFor(resized)[0]).toEqual(binding);
 expect(resized.lights[1]!.transform.position[1]).toBe(4.98);
 expect(validateStudioLightDetails(resized).valid).toBe(true);
});
