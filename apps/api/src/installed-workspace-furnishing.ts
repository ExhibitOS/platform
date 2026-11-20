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
// Retained by the exact caption-stand saves. It is not offered by the current catalogue.
const captionStand: Installed = {
 catalogId:'compact-caption-stand',
 path:'assets/furnishings/exhibitos-authored-20261111/compact-caption-stand/model.glb',
 descriptor:{
  id:'a358b4d2-8f6c-5c0f-8421-a06e90624a94',version:1,kind:'info-stand',name:'Compact Caption Stand',
  model:{mime:'model/gltf-binary',bytes:13864,sha256:'ec9e424fe07eceeb4b422c0ed3dfa6981ac9f5dc335bd6ed32954d2c1a190752'},
  rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},
  provenance:'ExhibitOS default furnishings, compact-caption-stand v1.',
 },
 notice:{path:'assets/furnishings/exhibitos-authored-20261111/compact-caption-stand/LICENSE-NOTICE.txt',bytes:580,sha256:'5d90fcaaec647de18cf2be4b7bf46927b8136080c3cd7f37c3ee1efe3336b87f'},
};
const retainedHosts=[...hosts,captionStand];
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
 const host=retainedHosts.find(item=>item.descriptor.id===id.toLowerCase());
 return host?structuredClone(host.descriptor):installedFrameDescriptorFor(id);
}

export async function readInstalledFurnishingModel(id:string,signal?:AbortSignal){
 const host=retainedHosts.find(item=>item.descriptor.id===id.toLowerCase());
 if(!host)return readInstalledFrameById(id,signal);
 const {model}=host.descriptor;
 const bytes=await readInstalledFurnishing(host.path,model.bytes,model.sha256,signal,true);
 if(host===captionStand){
  const {path,bytes:noticeBytes,sha256}=captionStand.notice!;
  if(!bytes||!await readInstalledFurnishing(path,noticeBytes,sha256,signal,true))return;
 }
 return bytes===undefined?undefined:{bytes,mime:model.mime,sha256:model.sha256};
}

export function matchingInstalledFurnishingDescriptor(value:WorkspaceFurnishingDescriptor,publicId?:string):WorkspaceFurnishingDescriptor|undefined{
 const host=retainedHosts.find(({descriptor})=>isDeepStrictEqual({...descriptor,id:publicId??descriptor.id},value));
 return host?structuredClone(host.descriptor):matchingInstalledFrameDescriptor(value,publicId);
}

export function matchesInstalledFurnishing(value:WorkspaceFurnishingDescriptor,publicId?:string):boolean{
 return matchingInstalledFurnishingDescriptor(value,publicId)!==undefined;
}
