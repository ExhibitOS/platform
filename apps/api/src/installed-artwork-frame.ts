// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {readInstalledFurnishing} from './furnishing-assets.ts';

export const INSTALLED_FRAME_ID = '4e670339-c7db-4d89-9430-94f24761b6b7';
const path = 'assets/furnishings/user-authored-20261027/black-aluminum-frame/model.glb';

export function installedFrameDescriptor(): WorkspaceFurnishingDescriptor {
 return {
  id:INSTALLED_FRAME_ID, version:1, kind:'artwork-frame', name:'검은 알루미늄 액자',
  model:{mime:'model/gltf-binary',bytes:101720,sha256:'2fb941a9f6ed030638512e917e348a0a3000e29c1133fe3f9670268ff1c4169c'},
  rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',
   permissions:{display:true,download:true,export:true,commercial:true}},
  provenance:'ExhibitOS default furnishings, black-aluminum-frame v1.',
 };
}

export async function readInstalledFrame(signal?:AbortSignal) {
 const {model} = installedFrameDescriptor();
 const bytes = await readInstalledFurnishing(path,model.bytes,model.sha256,signal,true);
 return bytes === undefined ? undefined : {bytes,mime:model.mime,sha256:model.sha256};
}

export function matchesInstalledFrame(value:WorkspaceFurnishingDescriptor,publicId?:string):boolean {
 const expected=installedFrameDescriptor();
 if(publicId!==undefined)expected.id=publicId;
 return isDeepStrictEqual(value,expected);
}
