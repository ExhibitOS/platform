// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {LIGHT_DETAILS_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,lightDetailsFor,resolveTrackSpotAiming,validateFurnishings,validateStudioLightDetails,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {articulatedTrackSpotCandidate,lightId} from '../../../packages/studio-contract/test-fixtures/articulated-track-spot.js';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {remapOex} from './oex.ts';
it('persists typed mount and aim intent and remaps both links while emitting resolved OEX optics',()=>{
 const {candidate}=articulatedTrackSpotCandidate(),draft=newDraft();candidate.placements[0]!.transform.position[0]+=.1;const before=structuredClone(candidate);draft.candidate=candidate;draft.exhibitionId=candidate.id;
 expect(validateDraft(draft).valid).toBe(true);
 const roundtrip=JSON.parse(JSON.stringify(draft));expect(validateDraft(roundtrip).valid).toBe(true);
 const workspace=candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 const {exhibition,idMap}=remapOex(roundtrip.candidate,workspace),binding=lightDetailsFor(exhibition)[0]!.trackAim!,original=lightDetailsFor(candidate)[0]!.trackAim!;
 expect(binding.mount.railPlacementId).toBe(idMap[original.mount.railPlacementId]);expect(binding.mount.railPlacementId).not.toBe(original.mount.railPlacementId);
 expect(binding.aim.kind).toBe('placement-center');if(binding.aim.kind!=='placement-center'||original.aim.kind!=='placement-center')throw Error('TARGET_REQUIRED');
 expect(binding.aim.placementId).toBe(idMap[original.aim.placementId]);expect(binding.aim.offset).toEqual(original.aim.offset);
 expect(validateFurnishings(exhibition).valid).toBe(true);expect(validateStudioLightDetails(exhibition).valid).toBe(true);
 const resolved=resolveTrackSpotAiming(exhibition,idMap[lightId]!);expect(resolved.reachable).toBe(true);if(!resolved.reachable)throw Error(resolved.reason);
 expect(exhibition.lights[0]!.transform.position).toEqual(resolved.emitter);expect(exhibition.lights[0]!.transform.rotation).toEqual(resolved.headPose.rotation);
 expect(candidate).toEqual(before);
});
it('rejects missing target references before output instead of retaining stale base optics',()=>{
 const {candidate}=articulatedTrackSpotCandidate();candidate.placements=[];
 expect(validateStudioLightDetails(candidate).valid).toBe(false);expect(()=>remapOex(candidate)).toThrow();
 expect(candidate.extensions![LIGHT_DETAILS_NAMESPACE]).toBeDefined();
});
