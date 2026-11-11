// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {applyFurnishingCommand,furnishingsFor,setLightDetails,validateFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import type {NativeFixtureScope} from './native-fixture-proposal.ts';
import {nativeLightObjectProposal} from './native-light-object-proposal.ts';
function fixture(){
 let candidate=newDraft().candidate;candidate.surfaces=whiteCubeSurfaces(candidate.rooms[0]!);
 const light=newLight(candidate.rooms[0]!.id,'spot');light.transform.position=[0,2,0];candidate.lights.push(light);
 const {id,...fields}=light;candidate=setLightDetails(candidate,id,fields,{fixture:'none'});
 const scope:NativeFixtureScope={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),exhibitionId:candidate.id,head:'saved-head',requestId:randomUUID(),epoch:randomUUID(),sequence:1};
 return {candidate,light,fields,scope};
}
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
