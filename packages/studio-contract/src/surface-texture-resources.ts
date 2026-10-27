// SPDX-License-Identifier: AGPL-3.0-or-later
import {SURFACE_MATERIAL_PACKS,selectedSurfaceMaterialPacks,type SurfaceMaterialPack} from '@exhibitos/spec/surface-material-resources';
import type {SurfaceTextureBinding} from './surface-textures.js';
export const SURFACE_TEXTURE_PACKS=SURFACE_MATERIAL_PACKS;
export const SURFACE_TEXTURE_FILES=Object.freeze(SURFACE_TEXTURE_PACKS.flatMap(pack=>Object.values(pack.maps)));
export function surfaceTexturePack(binding:SurfaceTextureBinding):SurfaceMaterialPack|undefined{return SURFACE_TEXTURE_PACKS.find(pack=>pack.id===binding.pack.id&&pack.version===binding.pack.version);}
export const requiredSurfaceTexturePacks=selectedSurfaceMaterialPacks;
