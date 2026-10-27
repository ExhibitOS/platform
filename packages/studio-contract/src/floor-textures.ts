// SPDX-License-Identifier: AGPL-3.0-or-later
import {floorFor,floorPresetDefaults,validateStudioFloors,type FloorBinding,type StudioFloors} from './floors.js';
export type FloorMapRole='color'|'roughness'|'normal'|'ao';
export interface FloorTextureFile {readonly path:string;readonly mime:'image/png';readonly bytes:number;readonly sha256:string;readonly width:number;readonly height:number;readonly channels:3;readonly bitDepth:8;readonly colorSpace:'srgb'|'linear'}
export interface FloorTexturePackDescriptor {readonly id:string;readonly version:1;readonly maps:Readonly<Partial<Record<FloorMapRole,FloorTextureFile>>>;readonly credit:string;readonly source:string;readonly license:'CC0-1.0';readonly licenseSource:string;readonly changes:string}
const file=(name:string,bytes:number,sha256:string,colorSpace:'srgb'|'linear'):FloorTextureFile=>Object.freeze({path:`floor-textures/WoodFloor051/1/${name}-${sha256.slice(0,12)}.png`,mime:'image/png',bytes,sha256,width:1024,height:1024,channels:3,bitDepth:8,colorSpace});
const freezePack=(pack:FloorTexturePackDescriptor):FloorTexturePackDescriptor=>Object.freeze({...pack,maps:Object.freeze(Object.fromEntries(Object.entries(pack.maps).map(([role,map])=>[role,Object.freeze(map)])))});
/** Fixed locally bundled, byte-qualified maps; registration does not imply rendered acceptance. */
export const FLOOR_TEXTURE_PACKS:readonly FloorTexturePackDescriptor[]=Object.freeze([Object.freeze({id:'WoodFloor051',version:1 as const,maps:Object.freeze({
 color:file('color',1235894,'68bad517cc4aafa4c5ab5812f6a2ee57068da49fcb9446941d44371d716b3ce3','srgb'),
 roughness:file('roughness',532165,'8c578dfb7c616d81cf89a666506759f29cbd88ba15c6ea0221e52f9e9d57ae43','linear'),
 normal:file('normal-gl',693158,'23d13c247759c1323ebb851149fb0f0f9d66be3f367264e897fb2352f2e65181','linear'),
}),credit:'Wood Floor 051, ambientCG.com, CC0 1.0',source:'https://ambientcg.com/view?id=WoodFloor051',license:'CC0-1.0' as const,licenseSource:'https://docs.ambientcg.com/license/',changes:'Metadata-free RGB8 encoding. Color samples preserved; grayscale roughness copied equally to RGB (G roughness). OpenGL normal converted from16 to8 bits by high-byte quantization (q=u16>>8; maximum encoded-channel error0.0038910505836575737). No green inversion, gamma, sharpening, tint, resize, displacement or invented AO. Authored1.8m patch repeat is editable, not a measured physical guarantee.'}),
freezePack({
  "id": "Marble006",
  "version": 1,
  "credit": "Marble006, ambientCG.com, CC0 1.0",
  "source": "https://ambientcg.com/view?id=Marble006",
  "license": "CC0-1.0",
  "licenseSource": "https://docs.ambientcg.com/license/",
  "maps": {
    "color": {
      "mime": "image/png",
      "bytes": 1798345,
      "sha256": "d44e0a2b040249c629a67aace4bf0f82a79c33199f1817d55cb1d199bbcefea2",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "srgb",
      "path": "floor-textures/Marble006/1/color-d44e0a2b0402.png"
    },
    "normal": {
      "mime": "image/png",
      "bytes": 538862,
      "sha256": "a61a93414470559bc5e7c1286b7bb93ea234546a315669161249c3f6433a8015",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Marble006/1/normal-gl-a61a93414470.png"
    },
    "roughness": {
      "mime": "image/png",
      "bytes": 690832,
      "sha256": "cd5898bc49d9d15a21740929731bffbbb97d06c3aa03642772e27fc50e629437",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Marble006/1/roughness-cd5898bc49d9.png"
    }
  },
  "changes": "Ancillarymetadata removed through fresh RGB8 encoding; grayscale scalar replicated identically to RGB; source16bit maps quantized highbyte to8bit as numerically recorded. Noresize/Gflip/gamma/tint/AI/sharpen/displacement; no inventedAO. Authored1m repeat; providerphysicalsizeunknown, notmeasured."
}),
freezePack({
  "id": "Tiles074",
  "version": 1,
  "credit": "Tiles074, ambientCG.com, CC0 1.0",
  "source": "https://ambientcg.com/view?id=Tiles074",
  "license": "CC0-1.0",
  "licenseSource": "https://docs.ambientcg.com/license/",
  "maps": {
    "color": {
      "mime": "image/png",
      "bytes": 1714324,
      "sha256": "99d35940d5ae7e645ea99f0d3c0d20eb73932d3d68303f534ac481afd0976f16",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "srgb",
      "path": "floor-textures/Tiles074/1/color-99d35940d5ae.png"
    },
    "normal": {
      "mime": "image/png",
      "bytes": 343061,
      "sha256": "89ad085427ad6ab8b446bc2a1da476195c889b7c51fec4000c64c47b560665d0",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Tiles074/1/normal-gl-89ad085427ad.png"
    },
    "roughness": {
      "mime": "image/png",
      "bytes": 604569,
      "sha256": "538f7d7c064513880c73c9ded25886de29e4200576275d3d324a4dedbb83d021",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Tiles074/1/roughness-538f7d7c0645.png"
    }
  },
  "changes": "Ancillarymetadata removed through fresh RGB8 encoding; grayscale scalar replicated identically to RGB; source16bit maps quantized highbyte to8bit as numerically recorded. Noresize/Gflip/gamma/tint/AI/sharpen/displacement; no inventedAO. ProviderapproximateWHOLE texturepatch2.1m; notindividualtilemeasurement orphysicalguarantee."
}),
freezePack({
  "id": "Carpet004",
  "version": 1,
  "credit": "Carpet004, ambientCG.com, CC0 1.0",
  "source": "https://ambientcg.com/view?id=Carpet004",
  "license": "CC0-1.0",
  "licenseSource": "https://docs.ambientcg.com/license/",
  "maps": {
    "ao": {
      "mime": "image/png",
      "bytes": 1462307,
      "sha256": "cba7d7a73cc9dd199e75ce8930189f7ca1a817d0dfd1f9fafd98b3be6caa1a18",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Carpet004/1/ao-cba7d7a73cc9.png"
    },
    "color": {
      "mime": "image/png",
      "bytes": 1932055,
      "sha256": "df90d6a3be6b2be92e89b830d41ec329a170266009a3cffa2e05bf043085b25f",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "srgb",
      "path": "floor-textures/Carpet004/1/color-df90d6a3be6b.png"
    },
    "normal": {
      "mime": "image/png",
      "bytes": 2704480,
      "sha256": "956a4ad49737669c6bb8b5c669db475239bc7a6d2556dcf8426b029bf92a09e4",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Carpet004/1/normal-gl-956a4ad49737.png"
    },
    "roughness": {
      "mime": "image/png",
      "bytes": 771102,
      "sha256": "6a60aa6770e64ad23992e6754657787e19417edb3620a625fac2398204b59854",
      "width": 1024,
      "height": 1024,
      "channels": 3,
      "bitDepth": 8,
      "colorSpace": "linear",
      "path": "floor-textures/Carpet004/1/roughness-6a60aa6770e6.png"
    }
  },
  "changes": "Ancillarymetadata removed through fresh RGB8 encoding; grayscale scalar replicated identically to RGB; source16bit maps quantized highbyte to8bit as numerically recorded. Noresize/Gflip/gamma/tint/AI/sharpen/displacement; no inventedAO. Authored1m repeat; providerphysicalsizeunknown, notmeasured."
})]);
export const floorTextureFiles=(pack:FloorTexturePackDescriptor)=>Object.values(pack.maps) as FloorTextureFile[];
export const FLOOR_TEXTURE_FILES:readonly FloorTextureFile[]=Object.freeze(FLOOR_TEXTURE_PACKS.flatMap(floorTextureFiles));
export function floorTexturePack(binding:FloorBinding){const selected=binding.texturePack??floorPresetDefaults(binding.preset).texturePack!;return FLOOR_TEXTURE_PACKS.find(p=>p.id===selected.id&&p.version===selected.version);}
export function requiredFloorTexturePacks(document:{extensions?:unknown;surfaces?:readonly {type:string;roomId:string}[]}){
 if(!validateStudioFloors(document).valid)throw Error('FLOOR_SCHEMA');
 const value=(document.extensions as Record<string,unknown>|undefined)?.['org.exhibitos.studio/floors'] as StudioFloors|undefined,used=new Set<string>();
 for(const b of value?.bindings??[]){if(b.target.kind==='room-base'&&!floorFor(document,{roomId:b.target.roomId}))continue;const pack=floorTexturePack(b);if(pack)used.add(pack.id);}
 return FLOOR_TEXTURE_PACKS.filter(p=>used.has(p.id));
}
export function floorTextureNotice(pack:FloorTexturePackDescriptor){return `${pack.credit}\nSource: ${pack.source}\nLicense: ${pack.license} (${pack.licenseSource})\nChanges: ${pack.changes}\n`;}
