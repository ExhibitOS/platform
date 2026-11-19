// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {
 installedFrameDescriptors,installedFrameDescriptorFor,matchingInstalledFrameDescriptor,readInstalledFrameById,
} from './installed-artwork-frame.ts';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import authoredHosts from './installed-workspace-hosts.json' with {type:'json'};

const hosts=authoredHosts as unknown as readonly {path:string;descriptor:WorkspaceFurnishingDescriptor}[];

export function installedFurnishingDescriptors():WorkspaceFurnishingDescriptor[]{
 return [...installedFrameDescriptors(),...hosts.map(item=>structuredClone(item.descriptor))];
}

export function installedFurnishingDescriptorFor(id:string):WorkspaceFurnishingDescriptor|undefined{
 const host=hosts.find(item=>item.descriptor.id===id.toLowerCase());
 return host?structuredClone(host.descriptor):installedFrameDescriptorFor(id);
}

export async function readInstalledFurnishingModel(id:string,signal?:AbortSignal){
 const host=hosts.find(item=>item.descriptor.id===id.toLowerCase());
 if(!host)return readInstalledFrameById(id,signal);
 const {model}=host.descriptor;
 const bytes=await readInstalledFurnishing(host.path,model.bytes,model.sha256,signal,true);
 return bytes===undefined?undefined:{bytes,mime:model.mime,sha256:model.sha256};
}

export function matchingInstalledFurnishingDescriptor(value:WorkspaceFurnishingDescriptor,publicId?:string):WorkspaceFurnishingDescriptor|undefined{
 const host=hosts.find(({descriptor})=>isDeepStrictEqual({...descriptor,id:publicId??descriptor.id},value));
 return host?structuredClone(host.descriptor):matchingInstalledFrameDescriptor(value,publicId);
}

export function matchesInstalledFurnishing(value:WorkspaceFurnishingDescriptor,publicId?:string):boolean{
 return matchingInstalledFurnishingDescriptor(value,publicId)!==undefined;
}
