// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateExhibition,type Exhibition} from '@exhibitos/spec';
import {newDraft} from '../../../apps/web/src/drafts/example.js';
import {applyLightObjectCommand} from './light-object.js';
import {furnishingsFor,resolveFurnishing,validateFurnishings,FURNISHING_NAMESPACE} from './furnishings.js';
import {lightDetailsFor,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE} from './light-details.js';
import {lightAttachmentPose,lightAttachmentsFor,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE} from './room-envelope.js';

const lightId='a0000000-0000-4000-8000-000000000001',assetId='a0000000-0000-4000-8000-000000000002';
const emitter:[number,number,number]=[-2.457939962346657,3.8619541213603323,2.5];
export function paintingWasherCandidate(){
 const base=newDraft('Painting washer source qualification').candidate,room=base.rooms[0]!,q=Math.SQRT1_2;
 room.transform.position=[0,0,-7];
 const ceiling={id:'a0000000-0000-4000-8000-000000000003',roomId:room.id,type:'ceiling' as const,dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,4,0] as [number,number,number],rotation:[q,0,0,q] as [number,number,number,number],scale:[1,1,1] as [number,number,number]}};
 base.surfaces=[ceiling];base.placements=[];base.artworks=[];base.mediaAssets=[];
 base.lights=[{id:lightId,roomId:room.id,type:'spot',transform:{position:[0,3.8,0],rotation:[0,0,0,1],scale:[1,1,1]},color:[1,.8,.6],intensity:80,unit:'candela',castsShadow:false,beamAngle:.5}];
 const attachment={surfaceId:ceiling.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(ceiling,{...attachment,lightId});
 const {id:_,...fields}=base.lights[0]!;void _;
 const moved=applyLightObjectCommand(base,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[-3.94,1.5,2.5]}},attachment}).candidate;
 const candidate=applyLightObjectCommand(moved,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-wallwasher-rear-relief',catalogVersion:1,pose:{position:[0,.106,.05],yaw:0,scale:1}}},{newAssetId:assetId}).candidate;
 return {base,moved,candidate};
}
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
