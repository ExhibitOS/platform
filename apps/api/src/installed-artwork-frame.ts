// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import authoredFrames from './installed-artwork-frames.json' with {type:'json'};
import {ApiError} from './api-error.ts';
import {INSTALLED_FURNISHING_THUMBNAIL_PROFILE,type InstalledFurnishingThumbnail,type PackagedFurnishingThumbnail} from './installed-furnishing-thumbnail-contract.ts';
import {furnishingThumbnailCanonicalHash,furnishingThumbnailPngDescriptor,FURNISHING_THUMBNAIL_RECIPE_ID,FURNISHING_THUMBNAIL_TOOL_ID} from './workspace-furnishing-thumbnail-contract.ts';

export const INSTALLED_FRAME_ID = '4e670339-c7db-4d89-9430-94f24761b6b7';
type InstalledFrame={catalogId:string;path:string;descriptor:WorkspaceFurnishingDescriptor;thumbnail?:PackagedFurnishingThumbnail};
const frames=authoredFrames as unknown as readonly InstalledFrame[];

export function installedFrameDescriptors():WorkspaceFurnishingDescriptor[]{return frames.map(frame=>structuredClone(frame.descriptor));}
export function installedFrameDescriptorFor(id:string):WorkspaceFurnishingDescriptor|undefined{
 const frame=frames.find(frame=>frame.descriptor.id===id.toLowerCase());return frame&&structuredClone(frame.descriptor);
}

export function installedFrameDescriptor(): WorkspaceFurnishingDescriptor {
 return installedFrameDescriptorFor(INSTALLED_FRAME_ID)!;
}

export async function readInstalledFrame(signal?:AbortSignal) {
 return readInstalledFrameById(INSTALLED_FRAME_ID,signal);
}

export async function readInstalledFrameById(id:string,signal?:AbortSignal){
 const frame=frames.find(frame=>frame.descriptor.id===id.toLowerCase());if(!frame)return;
 const {model}=frame.descriptor;
 const bytes = await readInstalledFurnishing(frame.path,model.bytes,model.sha256,signal,true);
 return bytes === undefined ? undefined : {bytes,mime:model.mime,sha256:model.sha256};
}

export function matchingInstalledFrameDescriptor(value:WorkspaceFurnishingDescriptor,publicId?:string):WorkspaceFurnishingDescriptor|undefined{
 for(const frame of frames){const expected=structuredClone(frame.descriptor);if(publicId!==undefined)expected.id=publicId;if(isDeepStrictEqual(value,expected))return structuredClone(frame.descriptor);}
}
export function matchesInstalledFrame(value:WorkspaceFurnishingDescriptor,publicId?:string):boolean{return matchingInstalledFrameDescriptor(value,publicId)!==undefined;}

/** Authored distribution metadata does not create a registered tenant candidate. */
export function installedFrameThumbnail(id:string):InstalledFurnishingThumbnail|undefined{
 const frame=frames.find(frame=>frame.descriptor.id===id.toLowerCase());if(!frame?.thumbnail)return;
 const {path}=frame.thumbnail,{descriptor}=frame,binding:InstalledFurnishingThumbnail={profile:frame.thumbnail.profile,source:structuredClone(frame.thumbnail.source),png:structuredClone(frame.thumbnail.png),provenance:{recipeId:frame.thumbnail.provenance.recipeId,toolId:frame.thumbnail.provenance.toolId,renderRequestId:frame.thumbnail.provenance.renderRequestId}};
 const source={furnishingId:descriptor.id,furnishingVersion:descriptor.version,modelSha256:descriptor.model.sha256,modelBytes:descriptor.model.bytes,descriptorSha256:furnishingThumbnailCanonicalHash(descriptor),rightsSha256:furnishingThumbnailCanonicalHash(descriptor.rights)};
 if(binding.profile!==INSTALLED_FURNISHING_THUMBNAIL_PROFILE||!isDeepStrictEqual(binding.source,source)||path!==frame.path.replace(/model\.glb$/,'thumbnail.png')||binding.provenance.recipeId!==FURNISHING_THUMBNAIL_RECIPE_ID||binding.provenance.toolId!==FURNISHING_THUMBNAIL_TOOL_ID||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding.provenance.renderRequestId)||binding.png.mime!=='image/png'||binding.png.width!==256||binding.png.height!==256||!Number.isSafeInteger(binding.png.bytes)||binding.png.bytes<33||binding.png.bytes>512*1024||!/^[a-f0-9]{64}$/.test(binding.png.sha256))throw new ApiError(409,'FURNISHING_INTEGRITY');
 return binding;
}
export async function readInstalledFrameThumbnail(id:string,signal?:AbortSignal){
 const thumbnail=installedFrameThumbnail(id);if(!thumbnail)return;
 const frame=frames.find(frame=>frame.descriptor.id===id.toLowerCase())!;
 const bytes=await readInstalledFurnishing(frame.thumbnail!.path,thumbnail.png.bytes,thumbnail.png.sha256,signal);
 if(!isDeepStrictEqual(furnishingThumbnailPngDescriptor(bytes),thumbnail.png))throw new ApiError(409,'FURNISHING_INTEGRITY');
 return {thumbnail,bytes};
}
