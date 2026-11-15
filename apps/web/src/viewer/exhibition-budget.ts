// SPDX-License-Identifier: AGPL-3.0-or-later
import {resolveViewerBudgetPolicy,selectViewerBudgetProfile} from '@exhibitos/studio-contract';
import {selectedDeviceBudget,type DeviceBudget} from './loading';
import {sceneTriangleLimit,SCENE_DRAW_LIMIT} from '../workspace-furnishing/scene-cost';
import {SHADOW_TRIANGLE_LIMIT} from './shadows';

/** Select quality/hardware recommendations first, then apply the exhibition's
 * explicit policy. Every admission consumer receives these same effective values. */
export function exhibitionViewerBudget(document:Parameters<typeof resolveViewerBudgetPolicy>[0],profile:Parameters<typeof resolveViewerBudgetPolicy>[1],recommended:DeviceBudget){
 const policy=resolveViewerBudgetPolicy(document,profile,{
  colorDraws:SCENE_DRAW_LIMIT,displayTriangles:sceneTriangleLimit(recommended,profile==='native'),
  shadowCasterTriangles:SHADOW_TRIANGLE_LIMIT,shadowDepthTriangles:SHADOW_TRIANGLE_LIMIT,
  residentBytes:recommended.maxCacheBytes,transitionBytes:recommended.maxTransitionBytes??recommended.maxCacheBytes,
 });
 const value=policy.admission;
 const budget:DeviceBudget={...recommended,viewerPolicy:policy,
  sceneAdmission:{colorDraws:value.colorDraws,displayTriangles:value.displayTriangles,shadowCasterTriangles:value.shadowCasterTriangles,shadowDepthTriangles:value.shadowDepthTriangles},
  maxSceneTriangles:value.displayTriangles,maxCacheBytes:value.residentBytes,maxTransitionBytes:value.transitionBytes,
  ...(recommended.materialPlanningBytes===undefined?{}:{materialPlanningBytes:Math.max(1,recommended.materialPlanningBytes+value.residentBytes-recommended.maxCacheBytes)}),
  ...(recommended.selectedImage?{selectedImage:{maxCacheBytes:policy.overrides.admission?.residentBytes===undefined?recommended.selectedImage.maxCacheBytes:value.residentBytes,maxTransitionBytes:policy.overrides.admission?.transitionBytes===undefined?recommended.selectedImage.maxTransitionBytes:value.transitionBytes}}:{}),
 };
 return {policy,budget};
}

export function selectedExhibitionViewerBudget(document:Parameters<typeof resolveViewerBudgetPolicy>[0],requested:'auto'|'compact'|'desktop',hints:Parameters<typeof selectedDeviceBudget>[1]){
 const automatic=selectedDeviceBudget('auto',hints);
 const selection=selectViewerBudgetProfile(document,{nativeEditor:false,automaticProfile:automatic.maxTextureSize<=512?'compact':'standard',...(requested==='auto'?{}:{requestedProfile:requested==='compact'?'compact':'standard'})});
 const recommended=selectedDeviceBudget(selection.effectiveProfile==='compact'?'compact':requested==='desktop'?'desktop':'auto',hints);
 return {...exhibitionViewerBudget(document,selection.effectiveProfile,recommended),selection};
}

/** Resident capacity and transition capacity are independent admissions. A
 * smaller transition override must never be silently raised to resident size. */
export function assetResourceLimits(resident:number,transition:number,reserved:number){
 if(![resident,transition,reserved].every(Number.isSafeInteger)||resident<1||transition<1||reserved<0||reserved>=resident||reserved>=transition)throw Error('MATERIAL_SOURCE_BUDGET');
 return {resident:resident-reserved,transition:transition-reserved};
}
