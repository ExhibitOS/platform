// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {requiredSurfaceTexturePacks,SURFACE_TEXTURE_FILES,surfaceTexturePack,surfaceTextureFor,wallFinishesFor,architecturalWallBoxes,type SurfaceTextureBinding} from '@exhibitos/studio-contract';
import {materialMapPlan} from './material-texture-plan';
import {wallOpeningShellReserve} from './wall-opening-shell';
import {createRegisteredMaterialTextureRenderer,type MaterialTextureFile} from './floor-texture-renderer';

export function surfaceTexturePlan(document:Exhibition,maxTextureSize:number,availableBytes:number){
 const packs=requiredSurfaceTexturePacks(document),files=packs.flatMap(pack=>Object.entries(pack.maps).map(([role,file])=>({role:role as 'color'|'normal'|'roughness',file})));
 // Joined opening shells own buffers even when their surfaces use scalar paint.
 // Textured structures also own the metric UV buffer, including during fallback.
 const geometryReserve=wallFinishesFor(document).reduce((sum,w)=>{
  const surface=document.surfaces.find(s=>s.id.toLowerCase()===w.surfaceId.toLowerCase())!;
  const boxes=architecturalWallBoxes(surface,document.openings,w).filter(b=>b.kind==='structure');
  const textured=surfaceTextureFor(document,w.surfaceId)!==undefined;
  if(boxes.length>1)return sum+wallOpeningShellReserve(boxes,textured);
  return sum+(textured?boxes.length*2*(24*32+36*4):0);
 },0);
 const cost=materialMapPlan(files.map(({role,file})=>({...file,role})),maxTextureSize,Math.max(0,availableBytes-geometryReserve));
 const sizes=new Map<MaterialTextureFile,number>(files.map(({file},i)=>[file,cost.sizes[i]??0]));
 return {packs:cost.blocked?[]:packs,blocked:cost.blocked?packs.map(p=>p.id):[],residentBytes:cost.residentBytes,reserveBytes:cost.reserveBytes+geometryReserve,geometryReserve,sizeFor:(file:MaterialTextureFile)=>sizes.get(file)??0};
}
/** Same verified byte reader, all-role publication and lease lifetime as floors. */
export function createSurfaceTextureRenderer(three:typeof Three,plan:ReturnType<typeof surfaceTexturePlan>,signal:AbortSignal,unavailable:()=>boolean,fetcher?:typeof fetch){
 return createRegisteredMaterialTextureRenderer<SurfaceTextureBinding>(three,plan,SURFACE_TEXTURE_FILES,surfaceTexturePack,signal,unavailable,fetcher);
}
