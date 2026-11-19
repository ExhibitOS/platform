// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {addRoomSupplementalCeilingFill,applyFurnishingCommand,ensureOrdinaryRoomBaseLight,furnishingsFor,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,ROOM_CEILING_FILL_PROFILE,setLightDetails,validateFurnishings,validateStudioLightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import type {NativeFixtureScope} from './native-fixture-proposal.ts';
import {nativeLightObjectProposal} from './native-light-object-proposal.ts';
import {assertLightFixtureDelta} from './light-fixture-admission.ts';
function fixture(){
 let candidate=newDraft().candidate;candidate.surfaces=whiteCubeSurfaces(candidate.rooms[0]!);
 const light=newLight(candidate.rooms[0]!.id,'spot');light.transform.position=[0,2,0];candidate.lights.push(light);
 const {id,...fields}=light;candidate=setLightDetails(candidate,id,fields,{fixture:'none'});
 const scope:NativeFixtureScope={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),exhibitionId:candidate.id,head:'saved-head',requestId:randomUUID(),epoch:randomUUID(),sequence:1};
 return {candidate,light,fields,scope};
}
it('returns the removed legacy point and an exact purpose-only fill promotion with deterministic saved-head recomputation',()=>{
 const f=fixture(),point=f.candidate.lights.find(row=>row.id===f.light.id)!;point.type='point';delete point.beamAngle;
 f.candidate.extensions={...f.candidate.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:[{lightId:point.id,fixture:'none',purpose:'room-base',range:10}]}};
 const fillId=randomUUID(),candidate=addRoomSupplementalCeilingFill(f.candidate,point.roomId,point.id,fillId),before=structuredClone(candidate),command={type:'remove-light-object' as const,lightId:point.id};
 const result=nativeLightObjectProposal(candidate,command,f.scope),expected=structuredClone(candidate);expected.lights=expected.lights.filter(row=>row.id!==point.id);
 expected.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:lightDetailsFor(candidate).filter(row=>row.lightId!==point.id).map(row=>row.lightId===fillId?{...row,purpose:'room-base' as const}:row)} as unknown as NonNullable<typeof expected.extensions>[string];
 expect(result).toEqual({candidate:expected,lightId:point.id});expect(validateStudioLightDetails(result.candidate).valid).toBe(true);expect(candidate).toEqual(before);
 expect(nativeLightObjectProposal(candidate,command,f.scope)).toEqual(result);
 expect(()=>nativeLightObjectProposal(result.candidate,command,{...f.scope,head:'new-saved-head',requestId:randomUUID()})).toThrow('LIGHT_OBJECT_REFERENCE');
});
it('derives replay-stable clone identity from the complete authenticated saved-head scope and fails closed on collision',()=>{
 const f=fixture(),before=structuredClone(f.candidate),command={type:'duplicate-light-object' as const,lightId:f.light.id};
 const a=nativeLightObjectProposal(f.candidate,command,f.scope);expect(nativeLightObjectProposal(f.candidate,command,f.scope)).toEqual(a);
 expect(a.lightId).not.toBe(f.light.id);expect(a.candidate.lights).toHaveLength(2);expect(a.candidate.lights.find(x=>x.id===a.lightId)).toMatchObject({...f.fields,id:a.lightId});
 for(const field of ['workspaceId','tenantId','principalId','exhibitionId','head','requestId','epoch','sequence'] as const){
  const scope={...f.scope,[field]:field==='sequence'?2:randomUUID()};expect(nativeLightObjectProposal(f.candidate,command,scope).lightId).not.toBe(a.lightId);
 }
 expect(()=>nativeLightObjectProposal(a.candidate,command,f.scope)).toThrow();expect(f.candidate).toEqual(before);
});
it('keeps GLB selection independent of fixture:none and removes it only through explicit visual:null',()=>{
 const f=fixture(),visual=applyFurnishingCommand(f.candidate,{type:'set-furnishing-visual',hostKind:'light',hostId:f.light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}},{newAssetId:randomUUID()});
 const before=structuredClone(visual),kept=nativeLightObjectProposal(visual,{type:'set-light-object',lightId:f.light.id,light:{...f.fields,intensity:100},settings:{fixture:'none'}},f.scope);
 expect(furnishingsFor(kept.candidate)).toEqual(furnishingsFor(visual));expect(kept.lightId).toBe(f.light.id);
 const removed=nativeLightObjectProposal(visual,{type:'set-light-fixture',lightId:f.light.id,visual:null},f.scope);expect(furnishingsFor(removed.candidate)?.bindings??[]).toHaveLength(0);expect(validateFurnishings(removed.candidate).valid).toBe(true);expect(visual).toEqual(before);
});
it('preserves exact set-object no-ops, returns the removed target, and rejects foreign and invalid furnishing graphs',()=>{
 const f=fixture(),before=structuredClone(f.candidate);
 expect(nativeLightObjectProposal(f.candidate,{type:'set-light-object',lightId:f.light.id,light:f.fields,settings:{fixture:'none'}},f.scope)).toEqual({candidate:before,lightId:f.light.id});
 const removed=nativeLightObjectProposal(f.candidate,{type:'remove-light-object',lightId:f.light.id},f.scope);expect(removed.lightId).toBe(f.light.id);expect(removed.candidate.lights).toHaveLength(0);
 expect(()=>nativeLightObjectProposal(f.candidate,{type:'remove-light-object',lightId:randomUUID()},f.scope)).toThrow();
 const broken=structuredClone(f.candidate);broken.extensions={...broken.extensions,'org.exhibitos.studio/furnishing-visuals':{version:1,assets:[],bindings:[{hostKind:'light',hostId:f.light.id,assetId:randomUUID(),pose:{position:[0,0,0],yaw:0,scale:1}}]}};
 expect(validateFurnishings(broken).valid).toBe(false);expect(()=>nativeLightObjectProposal(broken,{type:'remove-light-object',lightId:f.light.id},f.scope)).toThrow();expect(f.candidate).toEqual(before);
});

it('changes authored shadow intent through the scoped typed light operation and rejects nonboolean requests atomically',()=>{
 const f=fixture(),before=structuredClone(f.candidate),command={type:'set-light-object' as const,lightId:f.light.id,light:{...f.fields,castsShadow:true},settings:{fixture:'none' as const}};
 const enabled=nativeLightObjectProposal(f.candidate,command,f.scope);expect(enabled.candidate.lights[0]).toEqual({...before.lights[0],castsShadow:true});expect(f.candidate).toEqual(before);
 const disabled=nativeLightObjectProposal(enabled.candidate,{...command,light:{...f.fields,castsShadow:false}},f.scope);expect(disabled.candidate.lights[0]!.castsShadow).toBe(false);
 for(const invalid of ['true',1,null])expect(()=>nativeLightObjectProposal(f.candidate,{...command,light:{...f.fields,castsShadow:invalid as unknown as boolean}},f.scope)).toThrow();expect(f.candidate).toEqual(before);
});

it('creates one built-in or exact installed fixture atomically and preserves the room area path',async()=>{
 const {candidate,fields,scope}=fixture(),original=structuredClone(candidate);
 const command={type:'add-light-with-fixture' as const,light:{...fields,castsShadow:false},settings:{fixture:'spot-can' as const}};
 const builtIn=nativeLightObjectProposal(candidate,command,scope);
 expect(nativeLightObjectProposal(candidate,command,scope)).toEqual(builtIn);
 expect(lightDetailsFor(builtIn.candidate).find(row=>row.lightId===builtIn.lightId)?.fixture).toBe('spot-can');
 await expect(assertLightFixtureDelta(candidate,builtIn.candidate)).resolves.toBeUndefined();

 const visual=nativeLightObjectProposal(candidate,{...command,settings:{fixture:'none'},
  visual:{catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},scope);
 expect(furnishingsFor(visual.candidate)?.bindings).toEqual([expect.objectContaining({hostId:visual.lightId,hostKind:'light'})]);
 await expect(assertLightFixtureDelta(candidate,visual.candidate)).resolves.toBeUndefined();
 const detached=nativeLightObjectProposal(visual.candidate,{type:'set-light-fixture',lightId:visual.lightId,visual:null},scope);
 await expect(assertLightFixtureDelta(visual.candidate,detached.candidate)).rejects.toMatchObject({code:'LIGHT_FIXTURE_REQUIRED'});
 const removed=nativeLightObjectProposal(visual.candidate,{type:'remove-light-object',lightId:visual.lightId},scope);
 await expect(assertLightFixtureDelta(visual.candidate,removed.candidate)).resolves.toBeUndefined();
 expect(removed.candidate.lights).toEqual(candidate.lights);
 expect(furnishingsFor(removed.candidate)).toBeUndefined();

 expect(()=>nativeLightObjectProposal(candidate,{...command,settings:{fixture:'none'}},scope)).toThrow('LIGHT_FIXTURE_REQUIRED');
 const duplicate=nativeLightObjectProposal(candidate,{type:'duplicate-light-object',lightId:candidate.lights[0]!.id},scope);
 await expect(assertLightFixtureDelta(candidate,duplicate.candidate)).rejects.toMatchObject({code:'LIGHT_FIXTURE_REQUIRED'});
 await expect(assertLightFixtureDelta(candidate,candidate)).resolves.toBeUndefined();
 await expect(assertLightFixtureDelta(undefined,candidate)).rejects.toMatchObject({code:'LIGHT_FIXTURE_REQUIRED'});
 const area=ensureOrdinaryRoomBaseLight(candidate,fields.roomId,randomUUID(),ROOM_CEILING_FILL_PROFILE);
 expect(area.lights.at(-1)?.type).toBe('area');
 await expect(assertLightFixtureDelta(candidate,area)).resolves.toBeUndefined();
 expect(candidate).toEqual(original);
});
