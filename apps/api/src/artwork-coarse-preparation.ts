// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {sha256} from '@exhibitos/storage';
import {ApiError} from './api-error.ts';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {viewerVariants} from './viewer-variants.ts';
import {decode} from './validation-client.ts';
import {imageCoarsePolicy,type ImageCoarseIntent} from './image-coarse-intent.ts';

/** Derive only a reviewed, exact image pair. Caller must independently hold and
 * recheck same-owner source-job, current rights and byte custody before saving. */
export async function prepareReviewedImageCoarse(artwork:Artwork,primaryBytes:Buffer){
 const policy=qualifyDemoDisplay(artwork,primaryBytes),expected=policy?.coarse;
 if(!policy||!expected||artwork.artworkType!=='image')throw new ApiError(422,'COARSE_POLICY_UNQUALIFIED');
 return generate(primaryBytes,expected);
}
/** For an import worker only: source hash and full bytes must already have
 * been independently checked against the owned job; caller rechecks rights. */
export async function prepareIntentImageCoarse(intent:ImageCoarseIntent,originalSha256:string,primaryBytes:Buffer){
 const policy=imageCoarsePolicy(intent,originalSha256,sha256(primaryBytes),primaryBytes.length);
 return generate(primaryBytes,policy.coarse);
}
async function generate(primaryBytes:Buffer,expected:{sha256:string;bytes:number;width:number;height:number}){
 const generated=await viewerVariants(primaryBytes,'image/png');const coarse=generated.bytes;
 if(!coarse||!generated.coarse||generated.full.textureSize!==2048||generated.coarse.textureSize!==512||coarse.length!==expected.bytes||sha256(coarse)!==expected.sha256||coarse.length<33||coarse.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||coarse.readUInt32BE(16)!==expected.width||coarse.readUInt32BE(20)!==expected.height)throw new ApiError(422,'COARSE_POLICY_MISMATCH');
 await decode(coarse,'image/png');
 return {bytes:coarse,sha256:expected.sha256,width:expected.width,height:expected.height,profile:'viewer-png-box-512-v1' as const};
}
