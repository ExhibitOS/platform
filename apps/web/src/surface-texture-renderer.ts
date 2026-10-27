// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {requiredSurfaceTexturePacks,SURFACE_TEXTURE_FILES,surfaceTexturePack,surfaceTextureFor,wallFinishesFor,architecturalWallBoxes,type SurfaceTextureBinding} from '@exhibitos/studio-contract';
import {materialMapPlan} from './material-texture-plan';
import {createRegisteredMaterialTextureRenderer,type MaterialTextureFile} from './floor-texture-renderer';

export function surfaceTexturePlan(document:Exhibition,maxTextureSize:number,availableBytes:number){
 const packs=requiredSurfaceTexturePacks(document),files=packs.flatMap(pack=>Object.entries(pack.maps).map(([role,file])=>({role:role as 'color'|'normal'|'roughness',file})));
 // Styled structures need per-vertex metric UVs rather than the unit-box UVs
 // shared by instancing. Reserve their whole bounded replacement geometry.
 const geometryReserve=wallFinishesFor(document).filter(w=>surfaceTextureFor(document,w.surfaceId)).reduce((sum,w)=>sum+architecturalWallBoxes(document.surfaces.find(s=>s.id.toLowerCase()===w.surfaceId.toLowerCase())!,document.openings,w).filter(b=>b.kind==='structure').length*(24*32+36*4),0);
 const cost=materialMapPlan(files.map(({role,file})=>({...file,role})),maxTextureSize,Math.max(0,availableBytes-geometryReserve));
 const sizes=new Map<MaterialTextureFile,number>(files.map(({file},i)=>[file,cost.sizes[i]??0]));
 return {packs:cost.blocked?[]:packs,blocked:cost.blocked?packs.map(p=>p.id):[],residentBytes:cost.residentBytes,reserveBytes:cost.reserveBytes+geometryReserve,geometryReserve,sizeFor:(file:MaterialTextureFile)=>sizes.get(file)??0};
}
/** Same verified byte reader, all-role publication and lease lifetime as floors. */
export function createSurfaceTextureRenderer(three:typeof Three,plan:ReturnType<typeof surfaceTexturePlan>,signal:AbortSignal,unavailable:()=>boolean,fetcher?:typeof fetch){
 return createRegisteredMaterialTextureRenderer<SurfaceTextureBinding>(three,plan,SURFACE_TEXTURE_FILES,surfaceTexturePack,signal,unavailable,fetcher);
}
