// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {setViewerBudgetOverrides,resetViewerBudgetPolicy,VIEWER_BUDGET_NAMESPACE,resolveViewerBudgetPolicy,evaluateViewerBudgetUsage} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {DEVICE_BUDGETS,selectedDeviceBudget,AssetPeakBudget} from './loading';
import {sceneDrawLimit,sceneTriangleLimit} from '../workspace-furnishing/scene-cost';
import {exhibitionViewerBudget,selectedExhibitionViewerBudget,assetResourceLimits} from './exhibition-budget';

test('separates warning from effective reservation/live/geometry/byte admission and restores recommendations on reset',()=>{
 const document=newDraft().candidate,recommended=selectedDeviceBudget('auto',{coarsePointer:true,finePointer:false});
 const saved=setViewerBudgetOverrides(document,'standard',{warning:{colorDraws:1},admission:{colorDraws:512,displayTriangles:500000,shadowCasterTriangles:300000,shadowDepthTriangles:400000,residentBytes:512*1024*1024,transitionBytes:640*1024*1024}});
 const {budget,policy}=exhibitionViewerBudget(saved,'standard',recommended);
 expect(sceneDrawLimit(budget)).toBe(512);expect(sceneTriangleLimit(budget)).toBe(500000);expect(sceneTriangleLimit(budget,true)).toBe(500000);
 expect(budget.sceneAdmission).toMatchObject({shadowCasterTriangles:300000,shadowDepthTriangles:400000});
 expect(budget).toMatchObject({maxCacheBytes:512*1024*1024,maxTransitionBytes:640*1024*1024,maxTriangles:recommended.maxTriangles,maxTextureSize:recommended.maxTextureSize,concurrency:recommended.concurrency});
 expect(budget.materialPlanningBytes).toBe(recommended.materialPlanningBytes!+budget.maxCacheBytes-recommended.maxCacheBytes);
 expect(policy.warning.colorDraws).toBe(1);expect(policy.admission.colorDraws).toBe(512);
 const usage={scope:'wholeExhibition' as const,complete:true,colorDraws:400,displayTriangles:400000,shadowCasterTriangles:260000,shadowDepthTriangles:300000,residentBytes:400*1024*1024,transitionBytes:500*1024*1024,contributors:[]};
 expect(evaluateViewerBudgetUsage(policy,usage)).toEqual(evaluateViewerBudgetUsage(resolveViewerBudgetPolicy(saved,'standard',policy.recommended),usage));
 expect(evaluateViewerBudgetUsage(policy,usage).admissionExceeded).toEqual([]);
 const reset=exhibitionViewerBudget(resetViewerBudgetPolicy(saved),'standard',recommended);
 expect(sceneDrawLimit(reset.budget)).toBe(384);expect(sceneTriangleLimit(reset.budget)).toBe(350000);expect(reset.budget.maxCacheBytes).toBe(recommended.maxCacheBytes);expect(evaluateViewerBudgetUsage(reset.policy,usage).admissionExceeded).toContain('colorDraws');
});
test('selects persisted target before resolution, honors explicit visitor choice and keeps native editing separate',()=>{
 const document=newDraft().candidate;document.extensions={...document.extensions,[VIEWER_BUDGET_NAMESPACE]:{version:1,policyVersion:1,targetProfile:'compact',profiles:{compact:{admission:{colorDraws:420}},standard:{admission:{colorDraws:500}}}}};
 const auto=selectedExhibitionViewerBudget(document,'auto',{finePointer:true,coarsePointer:false});expect(auto.selection.effectiveProfile).toBe('compact');expect(auto.budget.maxTriangles).toBe(20000);expect(sceneDrawLimit(auto.budget)).toBe(420);
 const explicit=selectedExhibitionViewerBudget(document,'desktop',{finePointer:true,coarsePointer:false});expect(explicit.selection).toMatchObject({effectiveProfile:'standard',selection:'request'});expect(sceneDrawLimit(explicit.budget)).toBe(500);
 const native=exhibitionViewerBudget(document,'native',DEVICE_BUDGETS.desktop);expect(sceneDrawLimit(native.budget)).toBe(384);expect(native.policy.profile).toBe('native');
 const automatic=selectedExhibitionViewerBudget(newDraft().candidate,'auto',{deviceMemory:2});expect(automatic.selection.effectiveProfile).toBe('compact');
});

test('preserves the existing explicit image allowance without a memory override',()=>{
 const recommended=selectedDeviceBudget('compact',{deviceMemory:6}),document=newDraft().candidate;
 expect(recommended.selectedImage).toEqual({maxCacheBytes:96*1024*1024,maxTransitionBytes:128*1024*1024});
 expect(exhibitionViewerBudget(document,'compact',recommended).budget.selectedImage).toEqual(recommended.selectedImage);
 const warning=setViewerBudgetOverrides(document,'compact',{warning:{residentBytes:1}});expect(exhibitionViewerBudget(warning,'compact',recommended).budget.selectedImage).toEqual(recommended.selectedImage);
 const explicit=setViewerBudgetOverrides(document,'compact',{admission:{residentBytes:40*1024*1024,transitionBytes:50*1024*1024}});expect(exhibitionViewerBudget(explicit,'compact',recommended).budget.selectedImage).toEqual({maxCacheBytes:40*1024*1024,maxTransitionBytes:50*1024*1024});
});
test('honors a transition override below resident capacity rather than increasing the actual ledger',()=>{
 const mib=1024*1024,document=setViewerBudgetOverrides(newDraft().candidate,'standard',{admission:{residentBytes:512*mib,transitionBytes:128*mib}}),{budget}=exhibitionViewerBudget(document,'standard',DEVICE_BUDGETS.desktop);
 const limits=assetResourceLimits(budget.maxCacheBytes,budget.maxTransitionBytes!,32*mib);expect(limits).toEqual({resident:480*mib,transition:96*mib});
 const ledger=new AssetPeakBudget(limits.transition,()=>0);expect(()=>ledger.reserve('parse',97*mib)).toThrow('ASSET_TRANSITION_PEAK');ledger.reserve('parse',96*mib);ledger.release('parse');
 expect(()=>assetResourceLimits(budget.maxCacheBytes,budget.maxTransitionBytes!,129*mib)).toThrow('MATERIAL_SOURCE_BUDGET');
});
