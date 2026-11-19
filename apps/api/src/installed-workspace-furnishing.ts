// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {
 installedFrameDescriptors,installedFrameDescriptorFor,matchingInstalledFrameDescriptor,readInstalledFrameById,
} from './installed-artwork-frame.ts';
import {readInstalledFurnishing} from './furnishing-assets.ts';
import authoredFrames from './installed-artwork-frames.json' with {type:'json'};
import authoredHosts from './installed-workspace-hosts.json' with {type:'json'};

import type {DefaultCatalogueFile} from './default-catalogue-update-plan.ts';

type Installed = {catalogId:string;path:string;descriptor:WorkspaceFurnishingDescriptor;notice?:DefaultCatalogueFile};
const hosts=authoredHosts as unknown as readonly Installed[];
const frames=authoredFrames as unknown as readonly Installed[];

export function installedFurnishingCatalogueFile(descriptor:WorkspaceFurnishingDescriptor){
 const entry=[...frames,...hosts].find(item=>isDeepStrictEqual(item.descriptor,descriptor));
 if(!entry)return;
 const {bytes,sha256}=descriptor.model;
 return {catalogId:entry.catalogId, file:{path:entry.path,bytes,sha256},notice:entry.notice};
}

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
