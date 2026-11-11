// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateExhibition,type Exhibition} from '@exhibitos/spec';
import {furnishingsFor,resolveFurnishing,validateFurnishings,FURNISHING_NAMESPACE} from './furnishings.js';
import {lightDetailsFor,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE} from './light-details.js';
import {lightAttachmentPose,lightAttachmentsFor,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE} from './room-envelope.js';

import {paintingWasherCandidate,lightId,emitter} from '../test-fixtures/wallwasher.js';

function resolved(document:Exhibition){const f=furnishingsFor(document)!;return resolveFurnishing(document,f.bindings[0]!,f.assets[0]!);}

it('creates the required painting candidate through existing commands, retaining emitter attachment semantics',()=>{
 const {candidate}=paintingWasherCandidate(),before=structuredClone(candidate),result=resolved(candidate);
 expect(validateExhibition(candidate).errors).toEqual([]);
 expect(validateFurnishings(candidate).valid).toBe(true);expect(validateStudioLightDetails(candidate).valid).toBe(true);expect(validateLightAttachments(candidate).valid).toBe(true);
 expect(result.wallwasher).toBeDefined();const washer=result.wallwasher!;
 expect(washer.headPitch).toBe(-57.892880597116964*Math.PI/180);
 for(let i=0;i<3;i++){expect(washer.fixedPose.position[i]).toBeCloseTo([-2.45,4,2.5][i]!,12);expect(washer.emitter[i]).toBeCloseTo(emitter[i]!,12);}
 expect(candidate.lights[0]!.transform).toEqual(lightAttachmentPose(candidate.surfaces[0]!,lightAttachmentsFor(candidate)[0]!));
 expect(candidate.lights[0]!.transform.rotation).not.toEqual(washer.headPose.rotation);
 expect(washer.mountFootprintWorld.every(p=>Math.abs(p[1]-4)<1e-12)).toBe(true);expect(washer.parts).toHaveLength(13);
 expect(result.parent).toEqual({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});expect(result.pose).toEqual(result.parent);
 expect(candidate).toEqual(before);
});
it('keeps the admitted candidate and source identity through JSON reopen without rewriting attachment or aim',()=>{
 const {candidate}=paintingWasherCandidate(),reopened=JSON.parse(JSON.stringify(candidate)) as Exhibition;
 expect(validateFurnishings(reopened).valid).toBe(true);expect(resolved(reopened)).toEqual(resolved(candidate));
 expect(lightAttachmentsFor(reopened)).toEqual(lightAttachmentsFor(candidate));expect(lightDetailsFor(reopened)).toEqual(lightDetailsFor(candidate));
});
it.each(['hash','source','notice','version','bytes'])('rejects incoherent managed asset identity %s',kind=>{
 const {candidate}=paintingWasherCandidate(),f=furnishingsFor(candidate)!,asset=f.assets[0]!;
 if(kind==='hash')asset.sha256='0'.repeat(64);if(kind==='source')asset.provenance.sourceSha256='0'.repeat(64);if(kind==='notice')asset.rights.notice.sha256='0'.repeat(64);if(kind==='version')(asset as {catalogVersion:number}).catalogVersion=2;if(kind==='bytes')asset.bytes=203848;
 candidate.extensions![FURNISHING_NAMESPACE]=f as unknown as NonNullable<Exhibition['extensions']>[string];expect(validateFurnishings(candidate).valid).toBe(false);
});
it.each(['absent','wall','foreign-room','stored-emitter','base-rotation'])('rejects incoherent emitter attachment %s',kind=>{
 const {candidate}=paintingWasherCandidate();
 if(kind==='absent')delete candidate.extensions![LIGHT_ATTACHMENT_NAMESPACE];
 if(kind==='wall')candidate.surfaces[0]!.type='wall';
 if(kind==='foreign-room')candidate.surfaces[0]!.roomId=crypto.randomUUID();
 if(kind==='stored-emitter')candidate.lights[0]!.transform.position[1]-=.01;
 if(kind==='base-rotation')candidate.lights[0]!.transform.rotation=[0,0,0,1];
 expect(validateFurnishings(candidate).valid).toBe(false);
});
it.each(['offset','yaw','scale','unqualified-pitch'])('rejects unsupported visual or optical pose %s',kind=>{
 const {candidate}=paintingWasherCandidate(),f=furnishingsFor(candidate)!;
 if(kind==='offset')f.bindings[0]!.pose.position[0]=.01;if(kind==='yaw')f.bindings[0]!.pose.yaw=.1;if(kind==='scale')f.bindings[0]!.pose.scale=2;
 candidate.extensions![FURNISHING_NAMESPACE]=f as unknown as NonNullable<Exhibition['extensions']>[string];
 if(kind==='unqualified-pitch')candidate.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:[{lightId,fixture:'none',aim:{kind:'point',position:[-3,2,2.5]}}]};
 expect(validateFurnishings(candidate).valid).toBe(false);
});
it('checks actual mount contact instead of merely accepting an inside-room emitter',()=>{
 const {candidate}=paintingWasherCandidate();candidate.surfaces[0]!.transform.position[1]=3.95;
 candidate.lights[0]!.transform=lightAttachmentPose(candidate.surfaces[0]!,lightAttachmentsFor(candidate)[0]!);
 expect(validateLightAttachments(candidate).valid).toBe(true);expect(validateFurnishings(candidate).valid).toBe(false);
});
it('rejects a finite room-local candidate whose part corners exceed supported world coordinates',()=>{
 const {candidate}=paintingWasherCandidate();candidate.rooms[0]!.transform.position=[10000,0,0];candidate.rooms[0]!.transform.rotation=[0,1,0,0];
 expect(validateFurnishings(candidate).valid).toBe(false);
});
