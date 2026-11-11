// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {applyFurnishingCommand,furnishingsFor,lightAttachmentsFor,lightAttachmentPose,validateFurnishings,validateLightAttachments} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {nativeFixtureProposal,type NativeFixtureScope,type NativeFixtureCommand} from './native-fixture-proposal.ts';
function fixture(){
 const candidate=newDraft().candidate;candidate.surfaces=whiteCubeSurfaces(candidate.rooms[0]!);
 const light=newLight(candidate.rooms[0]!.id,'spot');light.transform.position=[0,2,0];candidate.lights.push(light);
 const ceiling=candidate.surfaces.find(v=>v.type==='ceiling')!;
 const scope:NativeFixtureScope={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),exhibitionId:candidate.id,head:'saved-head',requestId:randomUUID(),epoch:randomUUID(),sequence:1};
 const visual:NativeFixtureCommand={type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}};
 const attachment:NativeFixtureCommand={type:'set-light-attachment',lightId:light.id,attachment:{surfaceId:ceiling.id,anchor:[0,0],gap:.5}};
 return {candidate,light,ceiling,scope,visual,attachment};
}
it('replays a saved-head visual deterministically, preserves its light and reuses a saved catalogue asset',()=>{
 const f=fixture(),before=structuredClone(f.candidate),a=nativeFixtureProposal(f.candidate,f.visual,f.scope);
 expect(nativeFixtureProposal(f.candidate,f.visual,f.scope)).toEqual(a);
 const other=nativeFixtureProposal(f.candidate,f.visual,{...f.scope,head:'different-saved-head'});
 expect(furnishingsFor(other.candidate)?.assets[0]!.id).not.toBe(furnishingsFor(a.candidate)?.assets[0]!.id);expect(a).not.toHaveProperty('lightId');
 expect(a.candidate.lights).toEqual(before.lights);expect(a.candidate.artworks).toEqual(before.artworks);expect(f.candidate).toEqual(before);
 const second=newLight(f.light.roomId,'spot');second.transform.position=[1,2,0];a.candidate.lights.push(second);
 const next=nativeFixtureProposal(a.candidate,{...f.visual,hostId:second.id} as NativeFixtureCommand,{...f.scope,requestId:randomUUID()});
 expect(furnishingsFor(next.candidate)?.assets).toEqual(furnishingsFor(a.candidate)?.assets);
 expect(furnishingsFor(next.candidate)?.bindings).toHaveLength(2);
});
it('supports both complete valid operation orders, exact transformed pose and exact no-ops',()=>{
 const f=fixture(),attached=nativeFixtureProposal(f.candidate,f.attachment,f.scope);
 expect(attached.lightId).toBe(f.light.id);expect(attached.candidate.lights[0]!.transform).toEqual(lightAttachmentPose(f.ceiling,{...f.attachment.attachment,lightId:f.light.id}));
 const av=nativeFixtureProposal(attached.candidate,f.visual,f.scope),va=nativeFixtureProposal(nativeFixtureProposal(f.candidate,f.visual,f.scope).candidate,f.attachment,f.scope);
 expect(av.candidate).toEqual(va.candidate);expect(validateFurnishings(av.candidate).valid).toBe(true);expect(validateLightAttachments(av.candidate).valid).toBe(true);
 expect(nativeFixtureProposal(av.candidate,f.visual,f.scope).candidate).toEqual(av.candidate);
 expect(nativeFixtureProposal(av.candidate,f.attachment,f.scope).candidate).toEqual(av.candidate);
 expect(lightAttachmentsFor(av.candidate)).toHaveLength(1);
});
it('rejects wall/foreign surfaces, invalid alignment, invalid existing visual and any out-of-bounds result',()=>{
 const f=fixture(),wall=f.candidate.surfaces.find(v=>v.type==='wall')!;
 for(const surfaceId of [wall.id,randomUUID()])expect(()=>nativeFixtureProposal(f.candidate,{...f.attachment,attachment:{...f.attachment.attachment,surfaceId}} as NativeFixtureCommand,f.scope)).toThrow();
 expect(()=>nativeFixtureProposal(f.candidate,{...f.visual,pose:{position:[0,0,0],yaw:0,scale:1}} as NativeFixtureCommand,f.scope)).toThrow();
 const invalid=structuredClone(f.candidate);invalid.lights[0]!.transform.position=[0,100,0];expect(()=>nativeFixtureProposal(invalid,f.visual,f.scope)).toThrow();
 const visual=nativeFixtureProposal(f.candidate,f.visual,f.scope).candidate;
 // At the ceiling edge, the light anchor fits while its opaque fixture cannot.
 const attachment={...f.attachment,attachment:{...f.attachment.attachment,anchor:[f.ceiling.dimensions.width/2,0] as [number,number]}} as NativeFixtureCommand;
 expect(()=>nativeFixtureProposal(visual,attachment,f.scope)).toThrow();
});
it('the internal ID preserves default callers and rejects supplied collisions and invalid IDs',()=>{
 const f=fixture(),a=applyFurnishingCommand(f.candidate,f.visual),b=applyFurnishingCommand(f.candidate,f.visual);
 expect(furnishingsFor(a)?.assets[0]!.id).not.toBe(furnishingsFor(b)?.assets[0]!.id);
 expect(()=>applyFurnishingCommand(f.candidate,f.visual,{newAssetId:f.light.id})).toThrow();
 expect(()=>applyFurnishingCommand(f.candidate,f.visual,{newAssetId:'invalid'})).toThrow();
});


it('preserves all binding order and template flags on a valid non-last attachment no-op',()=>{
 const f=fixture();let next=nativeFixtureProposal(f.candidate,f.attachment,f.scope).candidate;
 const other=newLight(f.light.roomId,'point');other.transform.position=[1,2,0];next.lights.push(other);
 next=nativeFixtureProposal(next,{type:'set-light-attachment',lightId:other.id,attachment:{...f.attachment.attachment,anchor:[1,0]}},f.scope).candidate;
 const before=structuredClone(next);
 expect(lightAttachmentsFor(before)[0]!.lightId).toBe(f.light.id);
 expect(nativeFixtureProposal(next,f.attachment,f.scope).candidate).toEqual(before);
 expect(next).toEqual(before);
});
