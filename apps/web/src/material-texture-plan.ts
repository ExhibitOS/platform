// SPDX-License-Identifier: AGPL-3.0-or-later
import {textureResidentBytes} from './viewer/loading';

export interface MaterialMapCost {
 role:'color'|'normal'|'roughness'|'ao';
 bytes:number;width:number;height:number;
}
/** Planning includes temporary source decode/copies; completion releases only
 * that hold. The retained bitmap/GPU and styled geometry remain charged. */
export function materialPhaseBytes(plan:{reserveBytes:number;residentBytes:number;geometryReserve?:number},settled:boolean){
 return settled?plan.residentBytes+(plan.geometryReserve??0):plan.reserveBytes;
}
type MaterialPhasePlan={reserveBytes:number;residentBytes:number;geometryReserve?:number};
/** Floors load first. Precharge the larger of the two serial peaks before any
 * artwork starts, so settlement can only grow the existing allocator limits.
 * Both retained CPU bitmaps/GPU maps and already-built surface geometry remain
 * charged even if a pack fails; settlement never assumes a successful floor. */
export function serialMaterialPhaseBytes(floor:MaterialPhasePlan,surface:MaterialPhasePlan,floorSettled:boolean,surfaceSettled:boolean){
 if(surfaceSettled&&!floorSettled)throw Error('MATERIAL_PHASE_ORDER');
 const retainedFloor=materialPhaseBytes(floor,true);
 return floorSettled?retainedFloor+materialPhaseBytes(surface,surfaceSettled):Math.max(materialPhaseBytes(floor,false)+(surface.geometryReserve??0),retainedFloor+materialPhaseBytes(surface,false));
}
/** Only the existing two loads, in order; no background queue or new capacity.
 * A failed/cancelled phase returns its hold before the next can begin. */
export async function loadMaterialPhases(floor:()=>Promise<unknown>,surface:()=>Promise<unknown>,settled:(phase:'floor'|'surface',error?:unknown)=>void,unavailable:()=>boolean){
 for(const [phase,load]of [['floor',floor],['surface',surface]] as const){
  let failure:unknown;
  try{if(!unavailable())await load();}catch(error){failure=error;}
  finally{settled(phase,failure);}
 }
}
/** Preserve every authored role while allocating resolution independently.
 * Colour and normals retain detail ahead of the low-frequency scalar map.
 * Full encoded/decode cost is reserved even when the GPU image is resized.
 * A rejected pack keeps its scalar appearance; no partially ready PBR maps. */
export function materialMapPlan(files:readonly MaterialMapCost[],maxTextureSize:number,availableBytes:number){
 const limit=Math.max(0,Math.floor(availableBytes*.65));
 if(!files.length)return {sizes:[] as number[],reserveBytes:0,residentBytes:0,blocked:false};
 if(!Number.isFinite(maxTextureSize)||!Number.isFinite(availableBytes)||files.some(f=>!Number.isSafeInteger(f.bytes)||f.bytes<=0||!Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width!==f.height||f.width<=0))return {sizes:[],reserveBytes:0,residentBytes:0,blocked:true};
 const ceiling=Math.min(2048,2**Math.floor(Math.log2(Math.max(1,maxTextureSize))));
 for(let edge=ceiling;edge>=128;edge/=2){
  const sizes=files.map(f=>Math.min(f.width,Math.max(128,f.role==='roughness'||f.role==='ao'?edge/2:edge)));
  const residentBytes=files.reduce((n,_,i)=>n+textureResidentBytes(sizes[i]!,sizes[i]!),0);
  const peak=Math.max(...files.map((f,i)=>3*f.bytes+f.width*f.height*4+(sizes[i]!<f.width?sizes[i]!*sizes[i]!*4:0)));
  if(residentBytes+peak<=limit)return {sizes,reserveBytes:residentBytes+peak,residentBytes,blocked:false};
 }
 return {sizes:[],reserveBytes:0,residentBytes:0,blocked:true};
}
