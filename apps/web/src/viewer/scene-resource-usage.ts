// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {existingSceneCost} from '../workspace-furnishing/scene-cost';
import type {ShadowReport} from './shadows';

/** Raw renderer-owned observations. Policy evaluation belongs to the shared
 * contract. A mounted scene is not a complete inventory of unloaded assets. */
export type SceneResourceUsage={
 scope:'mounted-scene';
 complete:boolean;
 colorDraws:number;
 displayTriangles:number;
 shadowCasterTriangles:number|null;
 shadowDepthTriangles:number|null;
 shadowDepthDraws:number|null;
 residentBytes:number|null;
 transitionBytes:number|null;
 currentFrame:{scope:'current-view';colorAndDirtyDepthDraws:number|null;colorAndDirtyDepthTriangles:number|null};
 sections:{roomId:string;colorDraws:number;displayTriangles:number}[];
 assumptions:readonly string[];
};
const integer=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export function collectSceneResourceUsage(three:typeof Three,scene:Three.Object3D,rooms:ReadonlyMap<string,Three.Object3D>,input:{
 settled:boolean;shadow?:ShadowReport;residentBytes?:number;transitionBytes?:number;
 frame?:{calls:number;triangles:number};
}):SceneResourceUsage{
 const cost=existingSceneCost(three,scene);
 return {scope:'mounted-scene',complete:input.settled,colorDraws:cost.draws,displayTriangles:cost.triangles,
  shadowCasterTriangles:integer(input.shadow?.triangles),shadowDepthTriangles:integer(input.shadow?.depthTriangles),shadowDepthDraws:integer(input.shadow?.depthDraws),
  residentBytes:integer(input.residentBytes),transitionBytes:integer(input.transitionBytes),
  currentFrame:{scope:'current-view',colorAndDirtyDepthDraws:integer(input.frame?.calls),colorAndDirtyDepthTriangles:integer(input.frame?.triangles)},
  sections:[...rooms].map(([roomId,room])=>{const value=existingSceneCost(three,room);return {roomId,colorDraws:value.draws,displayTriangles:value.triangles};}).sort((a,b)=>b.colorDraws-a.colorDraws||b.displayTriangles-a.displayTriangles||a.roomId.localeCompare(b.roomId)),
  assumptions:['Conservative mounted geometry includes hidden objects and editor control envelopes.',
   'Room totals are contributors, not independent view maxima; a view can span rooms.',
   'Unloaded variants, downloads and unvisited views require final exhibition analysis.',
   'Resident and transition values are modeled allocation ledger bytes, not physical GPU memory.',
   'Current-frame counters include color and any dirty shadow passes; they are not GPU timing.'],
 };
}
