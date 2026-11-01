// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {setLightAttachment,lightAttachmentsFor,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE,setLightDetails,resizeRoomEnvelope} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {newLight} from '../placement/model';
import {whiteCubeSurfaces,createGeometryState,applyGeometryCommand,undoGeometry,redoGeometry} from './model';
import {validateDraft} from '../drafts/validator';
import {checkOexProfile,remapOex} from '../../../api/src/oex.ts';
import {projectPublication} from '../../../api/src/publication.ts';
function fixture(){
 const draft=newDraft(),room=draft.candidate.rooms[0]!;draft.candidate.surfaces=whiteCubeSurfaces(room);const l=newLight(room.id);l.transform.position=[0,room.dimensions.height-.2,0];draft.candidate.lights=[l];const {id,...light}=l;
 draft.candidate=setLightDetails(draft.candidate,id,light,{fixture:'disc',aim:{kind:'rotation'},range:12});
 draft.candidate=setLightAttachment(draft.candidate,id,{surfaceId:draft.candidate.surfaces.find(s=>s.type==='ceiling')!.id,anchor:[0,0],gap:.2});return draft;
}
test('browser and OEX admission reject detached stored poses instead of silently dropping attachment intent',()=>{
 const draft=fixture();expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
 const invalid=structuredClone(draft);invalid.candidate.lights[0]!.transform.position[1]-=.2;expect(validateDraft(invalid).valid).toBe(false);expect(()=>checkOexProfile(invalid.candidate)).toThrow('OEX_PROFILE_INVALID');
});
test('OEX and public projection preserve explicit attachment while remapping both light and surface identities',()=>{
 const doc=fixture().candidate,before=structuredClone(doc),original=lightAttachmentsFor(doc)[0]!;
 for(const projected of [remapOex(doc).exhibition,projectPublication(doc,[],'2026-10-26T00:00:00.000Z').snapshot]){
  const binding=lightAttachmentsFor(projected)[0]!;expect(validateLightAttachments(projected).valid).toBe(true);expect(binding.lightId).not.toBe(original.lightId);expect(binding.surfaceId).not.toBe(original.surfaceId);expect(binding.lightId).toBe(projected.lights[0]!.id);expect(projected.surfaces.some(s=>s.id===binding.surfaceId)).toBe(true);expect(binding.anchor).toEqual(original.anchor);expect(binding.gap).toBe(original.gap);expect(projected.extensions![LIGHT_ATTACHMENT_NAMESPACE]).toBeDefined();
 }expect(doc).toEqual(before);
});
test('the explicit room command is one reversible state with actual ceiling and light changes; legacy set-room remains distinct',()=>{
 const draft=fixture(),room=draft.candidate.rooms[0]!,initial=createGeometryState(draft.candidate),next=applyGeometryCommand(initial,{type:'resize-room-envelope',roomId:room.id,dimensions:{...room.dimensions,height:5}});
 expect(next.past).toHaveLength(1);expect(next.present.surfaces.find(s=>s.type==='ceiling')!.transform.position[1]).toBe(5);expect(next.present.lights[0]!.transform.position[1]).toBeCloseTo(4.8);expect(undoGeometry(next).present).toEqual(initial.present);expect(redoGeometry(undoGeometry(next)).present).toEqual(next.present);expect(resizeRoomEnvelope(initial.present,room.id,{...room.dimensions,height:5})).toEqual(next.present);
 const {id,...old}=room,legacy=applyGeometryCommand(initial,{type:'set-room',id,room:{...old,dimensions:{...old.dimensions,height:5}}});expect(legacy.present.surfaces).toEqual(initial.present.surfaces);expect(legacy.present.lights).toEqual(initial.present.lights);
 const removed=applyGeometryCommand(next,{type:'remove-light',id:next.present.lights[0]!.id});expect(lightAttachmentsFor(removed.present)).toEqual([]);expect(validateDraft({...draft,candidate:removed.present}).valid).toBe(true);
});
