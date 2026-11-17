// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {addRoomSupplementalCeilingFill,applyLightObjectCommand,ensureOrdinaryRoomBaseLight,ensureRoomBaseLight,lightDetailsFor,LIGHT_DETAILS_NAMESPACE,reflowRoomBaseLight,resizeRoomEnvelope,ROOM_CEILING_FILL_PROFILE,setLightDetails,type LightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {applyGeometryCommand,whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {ordinaryRoomBaseLightDelta} from './room-base-light-delta.ts';
const withBase=()=>{const d=newDraft();d.candidate=ensureRoomBaseLight(d.candidate,d.candidate.rooms[0]!.id);return d;};
const binding=(d:ReturnType<typeof newDraft>)=>lightDetailsFor(d.candidate)[0]!;
const change=(d:ReturnType<typeof newDraft>,edit:(copy:ReturnType<typeof newDraft>)=>void)=>{const next=structuredClone(d);edit(next);next.editVersion++;return next;};
it('admits one atomic new room and its canonical auto base; rejects a missing base and unrelated change',()=>{
 const before=newDraft(),room={...structuredClone(before.candidate.rooms[0]!),id:crypto.randomUUID(),name:'second',transform:{...before.candidate.rooms[0]!.transform,position:[20,0,0] as [number,number,number]}};
 const after=change(before,d=>{d.candidate.rooms.push(room);d.candidate=ensureRoomBaseLight(d.candidate,room.id);});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);
 const missing=change(before,d=>d.candidate.rooms.push(room));expect(ordinaryRoomBaseLightDelta(before,missing)).toBe(false);
 const mixed=structuredClone(after);mixed.candidate.title='unrelated';expect(ordinaryRoomBaseLightDelta(before,mixed)).toBe(false);
});
it('replays the negotiated area default on add and explicit ensure and rejects a different initial brightness',()=>{
 const before=withBase(),room={...structuredClone(before.candidate.rooms[0]!),id:crypto.randomUUID()};
 const added=change(before,d=>{d.candidate.rooms.push(room);d.candidate=ensureOrdinaryRoomBaseLight(d.candidate,room.id,undefined,ROOM_CEILING_FILL_PROFILE);});
 expect(ordinaryRoomBaseLightDelta(before,added)).toBe(true);
 expect(added.candidate.lights[0]).toEqual(before.candidate.lights[0]);
 const missing=newDraft(),roomId=missing.candidate.rooms[0]!.id;
 const ensured=change(missing,d=>{d.candidate=ensureOrdinaryRoomBaseLight(d.candidate,roomId,undefined,ROOM_CEILING_FILL_PROFILE);});
 expect(ordinaryRoomBaseLightDelta(missing,ensured)).toBe(true);
 const different=change(missing,d=>{d.candidate=ensureRoomBaseLight(d.candidate,roomId,undefined,.25);});
 expect(ordinaryRoomBaseLightDelta(missing,different)).toBe(false);
});
it('replays resize and world move without resetting off or RGB; reverse replay preserves atomic undo',()=>{
 const before=withBase();before.candidate.lights[0]!.intensity=0;before.candidate.lights[0]!.color=[.1,.3,.7];
 const after=change(before,d=>{d.candidate.rooms[0]!.dimensions.height=6;d.candidate.rooms[0]!.transform.position=[12,2,-5];d.candidate=reflowRoomBaseLight(d.candidate,d.candidate.rooms[0]!.id);});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);expect(after.candidate.lights[0]!.intensity).toBe(0);expect(after.candidate.lights[0]!.color).toEqual([.1,.3,.7]);
 expect(ordinaryRoomBaseLightDelta(after,before)).toBe(true);
 const stale=change(before,d=>{d.candidate.rooms[0]!.dimensions.height=6;});expect(ordinaryRoomBaseLightDelta(before,stale)).toBe(false);
});
it('manual and unknown base positions stay exact on room edits without coordinate inference',()=>{
 for(const mode of ['manual',undefined] as const){const before=withBase();const b=(before.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;if(mode)b.basePlacement=mode;else delete b.basePlacement;
 const original=structuredClone(before.candidate.lights[0]);const after=change(before,d=>{d.candidate.rooms[0]!.dimensions.height=7;});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);expect(after.candidate.lights[0]).toEqual(original);expect(binding(after).basePlacement).toBe(mode);
 const guessed=change(after,d=>{(d.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.basePlacement='auto';});expect(ordinaryRoomBaseLightDelta(after,guessed)).toBe(false);
 }
});
it('admits a tagged base removal and later room changes without resurrection',()=>{
 const before=withBase();const removed=change(before,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'remove-light-object',lightId:d.candidate.lights[0]!.id},{verifiedBaseline:d.candidate}).candidate;});
 expect(ordinaryRoomBaseLightDelta(before,removed)).toBe(true);
 const resized=change(removed,d=>{d.candidate.rooms[0]!.dimensions.height=6;});expect(ordinaryRoomBaseLightDelta(removed,resized)).toBe(true);expect(resized.candidate.lights).toHaveLength(0);
});
it('admits empty-room/base deletion only as one detached operation',()=>{
 const before=withBase(),after=change(before,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'remove-light-object',lightId:d.candidate.lights[0]!.id},{verifiedBaseline:d.candidate}).candidate;d.candidate.rooms=[];});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);
 const mixed=structuredClone(after);mixed.candidate.title='changed too';expect(ordinaryRoomBaseLightDelta(before,mixed)).toBe(false);
});
it('admits brightness only with omitted placement intent and rejects unrelated manual-light changes',()=>{
 const before=withBase(),after=change(before,d=>{const {id,...light}=d.candidate.lights[0]!,{lightId,basePlacement,...settings}=binding(d);void lightId;void basePlacement;d.candidate=setLightDetails(d.candidate,id,{...light,intensity:0,color:[.2,.4,.6]},settings);});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);expect(binding(after).basePlacement).toBe('auto');
 const manual={...structuredClone(before.candidate.lights[0]!),id:crypto.randomUUID()};before.candidate.lights.push(manual);const mixed=structuredClone(after);mixed.candidate.lights.push({...manual,intensity:3});expect(ordinaryRoomBaseLightDelta(before,mixed)).toBe(false);
});
it('admits a normalized ceiling fill brightness edit and rejects a forged lumen value or an incidental room edit',()=>{
 const before=newDraft();
 before.candidate=ensureRoomBaseLight(before.candidate,before.candidate.rooms[0]!.id,undefined,.5);
 const lightId=before.candidate.lights[0]!.id;
 const after=change(before,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'set-room-ceiling-fill-brightness',lightId,brightness:0}).candidate;});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);
 const forged=structuredClone(after);forged.candidate.lights[0]!.intensity=1;
 expect(ordinaryRoomBaseLightDelta(before,forged)).toBe(false);
 const mixed=structuredClone(after);mixed.candidate.rooms[0]!.name='unrelated';
 expect(ordinaryRoomBaseLightDelta(before,mixed)).toBe(false);
});
it('replays Auto ceiling fill with the actual six-surface resize and leaves non-envelope geometry alone',()=>{
 const before=newDraft(),room=before.candidate.rooms[0]!;
 before.candidate.surfaces=whiteCubeSurfaces(room);
 const wall=before.candidate.surfaces.find(surface=>surface.type==='wall')!;
 const interior={...structuredClone(wall),id:crypto.randomUUID(),dimensions:{width:1,height:1},transform:{...wall.transform,position:[0,1,0] as [number,number,number]}};
 before.candidate.surfaces.push(interior);
 before.candidate=ensureRoomBaseLight(before.candidate,room.id,undefined,0);
 const after=change(before,d=>{d.candidate=resizeRoomEnvelope(d.candidate,room.id,{width:room.dimensions.width+1,height:room.dimensions.height+1,depth:room.dimensions.depth+1});});
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);
 expect(after.candidate.surfaces.find(surface=>surface.id===interior.id)).toEqual(interior);
 expect(after.candidate.lights[0]!.intensity).toBe(0);
 const mixed=structuredClone(after);mixed.candidate.surfaces.find(surface=>surface.id===interior.id)!.dimensions.width=2;
 expect(ordinaryRoomBaseLightDelta(before,mixed)).toBe(false);
});
it('explicit manual and restore-auto operations are reversible without losing source or caller state',()=>{
 const before=withBase(),snapshot=structuredClone(before),manual=change(before,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'set-room-base-light-placement',lightId:d.candidate.lights[0]!.id,basePlacement:'manual'},{verifiedBaseline:d.candidate}).candidate;});
 expect(ordinaryRoomBaseLightDelta(before,manual)).toBe(true);expect(ordinaryRoomBaseLightDelta(manual,before)).toBe(true);expect(before).toEqual(snapshot);
});
it('rejects two-room changes and draft identity/bookkeeping changes outside the command',()=>{
 const before=withBase();before.candidate.rooms.push({...structuredClone(before.candidate.rooms[0]!),id:crypto.randomUUID(),name:'other'});
 const after=change(before,d=>{for(const room of d.candidate.rooms)room.name+=' changed';});expect(ordinaryRoomBaseLightDelta(before,after)).toBe(false);
 const single=change(before,d=>{d.candidate.rooms[0]!.name+=' renamed';});single.id=crypto.randomUUID();expect(ordinaryRoomBaseLightDelta(before,single)).toBe(false);
});
it('does not treat erasing saved intent as an ordinary edit; reverse replay identifies the undo boundary',()=>{
 const unknown=withBase(),entry=(unknown.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;delete entry.basePlacement;
 const optedIn=change(unknown,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'set-room-base-light-placement',lightId:d.candidate.lights[0]!.id,basePlacement:'auto'},{verifiedBaseline:d.candidate}).candidate;});
 expect(ordinaryRoomBaseLightDelta(unknown,optedIn)).toBe(true);expect(ordinaryRoomBaseLightDelta(optedIn,unknown)).toBe(false);
 const removed=change(unknown,d=>{d.candidate=applyLightObjectCommand(d.candidate,{type:'remove-light-object',lightId:d.candidate.lights[0]!.id},{verifiedBaseline:d.candidate}).candidate;});
 expect(ordinaryRoomBaseLightDelta(unknown,removed)).toBe(true);expect(ordinaryRoomBaseLightDelta(removed,unknown)).toBe(false);
});

it.each(['sign','normalization'])('admits actual web geometry %s-equivalent quaternion output without changing automatic placement intent',representation=>{
 const before=withBase();before.candidate.lights[0]!.intensity=0;before.candidate.lights[0]!.color=[.1,.3,.7];
 const source=before.candidate.lights[0]!;source.transform.rotation=[0,Math.sin(.3),0,Math.cos(.3)];
 const {id,...light}=structuredClone(source),factor=representation==='sign'?-1:1+1e-8;
 light.transform.rotation=light.transform.rotation.map(n=>n*factor) as typeof light.transform.rotation;
 const output=applyGeometryCommand({present:before.candidate,past:[],future:[]},{type:'set-light',id,light});
 const after=change(before,d=>{d.candidate=output.present;});
 expect(binding(after).basePlacement).toBe('auto');expect(after.candidate.lights[0]!.transform.rotation).toEqual(light.transform.rotation);
 expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);expect(after.candidate.lights[0]!.intensity).toBe(0);expect(after.candidate.lights[0]!.color).toEqual(source.color);
 const unknown=structuredClone(before);delete (unknown.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.basePlacement;
 const legacy=applyGeometryCommand({present:unknown.candidate,past:[],future:[]},{type:'set-light',id,light});
 const legacyAfter=change(unknown,d=>{d.candidate=legacy.present;});expect(binding(legacyAfter).basePlacement).toBeUndefined();expect(ordinaryRoomBaseLightDelta(unknown,legacyAfter)).toBe(true);
});
it('a real light rotation remains a manual spatial edit, not quaternion representation equivalence',()=>{
 const before=withBase(),{id,...light}=structuredClone(before.candidate.lights[0]!);light.transform.rotation=[0,Math.sin(.1),0,Math.cos(.1)];
 const after=change(before,d=>{d.candidate=setLightDetails(d.candidate,id,light,{fixture:'none'});});
 expect(binding(after).basePlacement).toBe('manual');expect(ordinaryRoomBaseLightDelta(before,after)).toBe(true);
});

it('replays only an exact supplemental add or removal and rejects a changed legacy point',()=>{
 const before=withBase(),base=before.candidate.lights[0]!;
 const details=(before.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;
 delete details.basePlacement;
 details.range=10;
 const added=change(before,d=>{d.candidate=addRoomSupplementalCeilingFill(d.candidate,base.roomId,base.id,crypto.randomUUID());});
 expect(ordinaryRoomBaseLightDelta(before,added)).toBe(true);
 expect(ordinaryRoomBaseLightDelta(added,before)).toBe(true);
 const changed=structuredClone(added);
 changed.candidate.lights[0]!.intensity++;
 expect(ordinaryRoomBaseLightDelta(before,changed)).toBe(false);
});
