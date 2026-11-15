// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateExhibition} from '@exhibitos/spec';
import {articulatedTrackSpotCandidate,lightId} from '../test-fixtures/articulated-track-spot.js';
import {applyLightObjectCommand} from './light-object.js';
import {furnishingsFor,validateFurnishings,resolveFurnishing} from './furnishings.js';
import {lightDetailsFor,lightDetailsTarget,lightDetailsOrientation,remapStudioLightDetails,validateStudioLightDetails} from './light-details.js';
import {LIGHT_ATTACHMENT_NAMESPACE,lightAttachmentsFor,validateLightAttachments} from './room-envelope.js';
import {materializeTrackSpotAiming,resolveTrackSpotAiming} from './track-spot-aiming-resolver.js';
import {validateWorkspaceFurnishings} from './workspace-furnishing.js';
it('atomically enters the known profile through the existing fixture command and round-trips the full candidate',()=>{
 const {base,candidate,command}=articulatedTrackSpotCandidate(),before=structuredClone(candidate),f=furnishingsFor(candidate)!,row=f.bindings.find(b=>b.hostId===lightId)!,asset=f.assets.find(a=>a.id===row.assetId)!;
 expect(validateExhibition(candidate).errors).toEqual([]);
 expect(asset.catalogId).toBe('museum-track-spot-articulated');expect(validateFurnishings(candidate).valid).toBe(true);expect(validateStudioLightDetails(candidate).valid).toBe(true);expect(validateLightAttachments(candidate).valid).toBe(true);expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);
 expect(lightAttachmentsFor(candidate).find(b=>b.lightId===lightId)).toBeUndefined();expect(lightAttachmentsFor(base).find(b=>b.lightId===lightId)).toBeDefined();
 const resolved=resolveFurnishing(candidate,row,asset);expect('articulated' in resolved).toBe(true);if(!('articulated' in resolved))throw Error('fixture');expect(resolved.articulated.parts).toHaveLength(14);
 expect(validateFurnishings(JSON.parse(JSON.stringify(candidate))).valid).toBe(true);expect(candidate).toEqual(before);
 expect(applyLightObjectCommand(candidate,command,{verifiedBaseline:candidate}).candidate).toEqual(candidate);
});
it('recomputes actual optics after target motion while preserving adapter, authoring bytes and explicit target links',()=>{
 const {candidate,placementId}=articulatedTrackSpotCandidate(),first=resolveTrackSpotAiming(candidate,lightId);if(!first.reachable)throw Error(first.reason);
 candidate.placements.find(p=>p.id===placementId)!.transform.position[0]+=.2;const before=structuredClone(candidate),moved=resolveTrackSpotAiming(candidate,lightId);if(!moved.reachable)throw Error(moved.reason);
 expect(validateFurnishings(candidate).valid).toBe(true);expect(validateStudioLightDetails(candidate).valid).toBe(true);expect(moved.fixedPose).toEqual(first.fixedPose);expect(moved.emitter).not.toEqual(first.emitter);
 const details=lightDetailsFor(candidate).find(v=>v.lightId===lightId)!,light=candidate.lights.find(v=>v.id===lightId)!;
 expect(lightDetailsTarget(candidate,light,details)).toEqual(moved.resolvedTarget);expect(lightDetailsOrientation(candidate,light,details)).toEqual(moved.headPose.rotation);
 const output=materializeTrackSpotAiming(candidate);expect(output.lights.find(l=>l.id===lightId)!.transform.position).toEqual(moved.emitter);expect(candidate).toEqual(before);
 const ids=new Map([[lightId,'d0000000-0000-4000-8000-000000000001'],[details.trackAim!.mount.railPlacementId,'d0000000-0000-4000-8000-000000000002'],[placementId,'d0000000-0000-4000-8000-000000000003']]);
 const mapped=remapStudioLightDetails({version:1,lights:[details]},ids).lights[0]!;expect(mapped.trackAim!.mount.railPlacementId).toBe(ids.get(details.trackAim!.mount.railPlacementId));expect(mapped.trackAim!.aim).toMatchObject({kind:'placement-center',placementId:ids.get(placementId)});
});
it('supports manual and room-point aim with immutable shadow priority and ordinary intensity edits',()=>{
 const {candidate}=articulatedTrackSpotCandidate(),light=candidate.lights.find(v=>v.id===lightId)!,settings=lightDetailsFor(candidate).find(v=>v.lightId===lightId)!;
 light.targetPlacementId=candidate.placements[0]!.id;expect(validateStudioLightDetails(candidate).valid).toBe(true);
 const {id:_,...fields}=light;void _;const {lightId:__,...details}=settings;void __;
 const edited=applyLightObjectCommand(candidate,{type:'set-light-object',lightId,light:{...fields,intensity:14},settings:{...details,trackAim:{...settings.trackAim!,aim:{kind:'manual',yaw:.4,pitch:-.7}}}},{verifiedBaseline:candidate}).candidate;
 expect(edited.lights.find(v=>v.id===lightId)).toMatchObject({intensity:14,targetPlacementId:light.targetPlacementId});expect(validateFurnishings(edited).valid).toBe(true);
 const newLight=edited.lights.find(v=>v.id===lightId)!,{id:___,...nextFields}=newLight;void ___;
 const point=applyLightObjectCommand(edited,{type:'set-light-object',lightId,light:nextFields,settings:{...details,trackAim:{...settings.trackAim!,aim:{kind:'point',position:[-2,1.5,-4.8]}}}},{verifiedBaseline:edited}).candidate;
 expect(point.lights.find(v=>v.id===lightId)!.targetPlacementId).toBe(light.targetPlacementId);expect(validateStudioLightDetails(point).valid).toBe(true);
});
it('fails unreachable, missing target and dual authority without silently detaching, retargeting or saving a fallback',()=>{
 const {candidate,command}=articulatedTrackSpotCandidate(),before=structuredClone(candidate);
 const bad={...command,visual:{...command.visual,trackAim:{...command.visual.trackAim,aim:{kind:'point' as const,position:[-2.2,4,-4.8] as [number,number,number]}}}};
 expect(()=>applyLightObjectCommand(candidate,bad,{verifiedBaseline:candidate})).toThrow('TRACK_SPOT_AIM_OUTSIDE_ENVELOPE');expect(candidate).toEqual(before);
 expect(()=>applyLightObjectCommand(candidate,{type:'set-light-fixture',lightId,visual:null})).toThrow('TRACK_SPOT_AIM_EXPLICIT_MODE_CHANGE_REQUIRED');
 const dual=structuredClone(candidate),details=dual.extensions!['org.exhibitos.studio/light-details'] as unknown as {lights:{aim?:unknown}[]};details.lights[0]!.aim={kind:'rotation'};expect(validateStudioLightDetails(dual).valid).toBe(false);
 const attached=structuredClone(candidate);attached.extensions![LIGHT_ATTACHMENT_NAMESPACE]=structuredClone(articulatedTrackSpotCandidate().base.extensions![LIGHT_ATTACHMENT_NAMESPACE]!);expect(validateStudioLightDetails(attached).valid).toBe(false);
 candidate.placements=[];expect(validateStudioLightDetails(candidate).errors.some(e=>e.code==='TRACK_SPOT_AIM_INVALID_TARGET')).toBe(true);expect(validateFurnishings(candidate).valid).toBe(false);
});
it('deletes a configured light and its owned model/aim in one detached command',()=>{
 const {candidate}=articulatedTrackSpotCandidate(),before=structuredClone(candidate),next=applyLightObjectCommand(candidate,{type:'remove-light-object',lightId},{verifiedBaseline:candidate}).candidate;
 expect(next.lights.some(l=>l.id===lightId)).toBe(false);expect(lightDetailsFor(next).some(d=>d.lightId===lightId)).toBe(false);expect(furnishingsFor(next)?.bindings.some(b=>b.hostId===lightId)??false).toBe(false);expect(validateFurnishings(next).valid).toBe(true);expect(candidate).toEqual(before);
});
