// SPDX-License-Identifier: AGPL-3.0-or-later
import {FLOOR_RESOURCE_PACKS,floorResourceNotice,type FloorResourcePack,type FloorMapFile,type FloorMapRole} from '@exhibitos/spec/floor-resources';
import {floorFor,floorPresetDefaults,validateStudioFloors,type FloorBinding,type StudioFloors} from './floors.js';
export type {FloorMapRole};
export type FloorTextureFile=FloorMapFile;
export type FloorTexturePackDescriptor=FloorResourcePack;
/** One immutable public byte catalogue shared by archive and renderer consumers. */
export const FLOOR_TEXTURE_PACKS=FLOOR_RESOURCE_PACKS;
export const floorTextureFiles=(pack:FloorTexturePackDescriptor)=>Object.values(pack.maps) as FloorTextureFile[];
export const FLOOR_TEXTURE_FILES:readonly FloorTextureFile[]=Object.freeze(FLOOR_TEXTURE_PACKS.flatMap(floorTextureFiles));
export function floorTexturePack(binding:FloorBinding){const selected=binding.texturePack??floorPresetDefaults(binding.preset).texturePack!;return FLOOR_TEXTURE_PACKS.find(p=>p.id===selected.id&&p.version===selected.version);}
export function requiredFloorTexturePacks(document:{extensions?:unknown;surfaces?:readonly {type:string;roomId:string}[]}){
 if(!validateStudioFloors(document).valid)throw Error('FLOOR_SCHEMA');
 const value=(document.extensions as Record<string,unknown>|undefined)?.['org.exhibitos.studio/floors'] as StudioFloors|undefined,used=new Set<string>();
 for(const b of value?.bindings??[]){if(b.target.kind==='room-base'&&!floorFor(document,{roomId:b.target.roomId}))continue;const pack=floorTexturePack(b);if(pack)used.add(pack.id);}
 return FLOOR_TEXTURE_PACKS.filter(p=>used.has(p.id));
}
export const floorTextureNotice=floorResourceNotice;
