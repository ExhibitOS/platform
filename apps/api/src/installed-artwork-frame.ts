// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import authoredFrames from './installed-artwork-frames.json' with {type:'json'};

export const INSTALLED_FRAME_ID = '4e670339-c7db-4d89-9430-94f24761b6b7';
type InstalledFrame={catalogId:string;path:string;descriptor:WorkspaceFurnishingDescriptor};
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
