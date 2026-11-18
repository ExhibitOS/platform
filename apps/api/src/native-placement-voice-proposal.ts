// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {EXPERIENCE_NAMESPACE,experienceFor,validateViewerExperience} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import type {PoolClient} from 'pg';
import {Audio,audioMedia,validatePcmWav,type MediaAsset} from './audio.ts';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';

export interface NativePlacementVoiceCommand {
 type:'set-placement-voice';placementId:string;audioId:string;locale:string;transcript:string;expectedMediaAsset:MediaAsset;
}
/** Only the same exhibition's immutable approval and actual PCM bytes supply authority.
 * The caller's media snapshot is a comparison guard, never an asset producer. */
export async function nativePlacementVoiceProposal(c:PoolClient,s:Session,exhibitionId:string,candidate:Exhibition,command:NativePlacementVoiceCommand,blobs:BlobStore|undefined){
 uuid(command.placementId);uuid(command.audioId);
 if(!validateViewerExperience(candidate).valid||typeof command.locale!=='string'||!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(command.locale)||typeof command.transcript!=='string'||!command.transcript.trim()||command.transcript.length>16384)throw new ApiError(422,'PLACEMENT_VOICE_INVALID');
 const placement=candidate.placements.find(row=>row.id.toLowerCase()===command.placementId.toLowerCase());
 if(!placement)throw new ApiError(422,'PLACEMENT_VOICE_INVALID');
 const audio=await new Audio(blobs).approved(c,s,exhibitionId,command.audioId);
 if(!allowedRights(audio.rights,'export'))throw new ApiError(403,'AUDIO_RIGHTS_DENIED');
 const media=audioMedia(audio);
 if(!isDeepStrictEqual(command.expectedMediaAsset,media))throw new ApiError(409,'AUDIO_APPROVAL_CHANGED');
 if(!blobs)throw new ApiError(503,'STORAGE_UNAVAILABLE');
 const bytes=Buffer.from(await blobs.get(audio.object_key));
 if(bytes.length!==media.bytes||sha256(bytes)!==media.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 validatePcmWav(bytes);
 // Recheck time-dependent permission after storage I/O as on the approval path.
 if(!allowedRights(audio.rights,'display')||!allowedRights(audio.rights,'export'))throw new ApiError(403,'AUDIO_RIGHTS_DENIED');
 const next=structuredClone(candidate),existing=next.mediaAssets.filter(row=>row.id.toLowerCase()===media.id.toLowerCase());
 if(existing.length>1||existing.length===1&&!isDeepStrictEqual(existing[0],media))throw new ApiError(409,'AUDIO_APPROVAL_CHANGED');
 if(existing.length===0)next.mediaAssets.push(media);
 const experience=experienceFor(next),voice={placementId:placement.id,assetId:media.id,locale:command.locale,transcript:command.transcript};
 const index=experience.voices.findIndex(row=>row.placementId.toLowerCase()===placement.id.toLowerCase()&&row.locale.toLowerCase()===command.locale.toLowerCase());
 if(index<0)experience.voices.push(voice);else experience.voices[index]=voice;
 next.extensions={...next.extensions,[EXPERIENCE_NAMESPACE]:experience} as unknown as Exhibition['extensions'];
 if(!validateViewerExperience(next).valid)throw new ApiError(422,'PLACEMENT_VOICE_INVALID');
 return {candidate:next,placementId:placement.id};
}
