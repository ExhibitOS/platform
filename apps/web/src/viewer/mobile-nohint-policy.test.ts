// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {AssetPeakBudget,DEVICE_BUDGETS,DESKTOP_NEAR_BUDGET,deviceBudget,materialPlanningCapacity,selectedDeviceBudget} from './loading';
const mobile={coarsePointer:true,finePointer:false},mib=1024*1024;
test('ordinary selection preserves known/invalid hints and non-mobile pointer policies',()=>{
 for(const deviceMemory of [2,3,4,6,8,16,NaN,Infinity,-Infinity]){
  expect(selectedDeviceBudget('auto',{...mobile,deviceMemory})).toEqual(deviceBudget({...mobile,deviceMemory}));
  expect(selectedDeviceBudget('compact',{...mobile,deviceMemory})).toEqual(selectedDeviceBudget('compact',{deviceMemory}));
 }
 expect(selectedDeviceBudget('auto',{coarsePointer:false,finePointer:true})).toMatchObject({maxCacheBytes:320*mib,maxTransitionBytes:416*mib,maxTriangles:150000,maxSceneTriangles:200000});
 expect(selectedDeviceBudget('auto',{coarsePointer:true,finePointer:true})).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*mib,maxTransitionBytes:256*mib});
 for(const input of [{coarsePointer:false,finePointer:false},{}])expect(selectedDeviceBudget('auto',input)).toEqual(DEVICE_BUDGETS.desktop);
 for(const input of [{coarsePointer:false,finePointer:true},{coarsePointer:true,finePointer:true},{coarsePointer:false,finePointer:false},{coarsePointer:true},{}])expect(selectedDeviceBudget('compact',input)).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('desktop',mobile)).toEqual(DESKTOP_NEAR_BUDGET);
});
test('current R97 Compact costs leave aggregate headroom without lifting model quality or concurrency',()=>{
 const current=DEVICE_BUDGETS.compact,candidate=selectedDeviceBudget('compact',mobile);
 expect(current.maxSceneTriangles??current.maxTriangles).toBe(20000);
 expect(candidate).toEqual({...current,maxCacheBytes:128*mib,maxTransitionBytes:160*mib,maxSceneTriangles:160000});
 const observed=114519;
 expect(observed).toBeGreaterThan(100000);
 expect(candidate.maxSceneTriangles!-observed).toBeGreaterThan(candidate.maxSceneTriangles!*.25);
 expect(candidate.maxTriangles).toBe(20000);expect(candidate.maxTextureSize).toBe(512);
 expect(candidate.maxPixelRatio).toBe(1);expect(candidate.concurrency).toBe(2);
});
test('Auto keeps its ordinary tier and reserves aggregate room for the current Greek plus Hayes swap',()=>{
 const current=deviceBudget(mobile),candidate=selectedDeviceBudget('auto',mobile);
 expect(candidate).toEqual({...current,maxCacheBytes:336*mib,maxTransitionBytes:448*mib,materialPlanningBytes:192*mib,maxSceneTriangles:250000});
 // Current five-model Compact scene, replacing only Hayes20k with ordinary100k.
 const modeled=114519+80000;
 expect(candidate.maxSceneTriangles!-modeled).toBeGreaterThan(candidate.maxSceneTriangles!*.2);
 expect(candidate.maxTriangles).toBe(100000);expect(candidate.maxTextureSize).toBe(2048);
 expect(candidate.maxPixelRatio).toBe(1.5);expect(candidate.concurrency).toBe(3);
});
test('extra artwork bytes do not enlarge control material planning or erase reservations',()=>{
 const control=deviceBudget(mobile),candidate=selectedDeviceBudget('auto',mobile);
 for(const overhead of [18350080,122338006])for(const frame of [0,mib]){
  const old=materialPlanningCapacity(control.maxCacheBytes-overhead,frame,control);
  expect(materialPlanningCapacity(candidate.maxCacheBytes-overhead,frame,candidate)).toBe(old);
 }
 expect(materialPlanningCapacity(50,2)).toBe(48);
 expect(materialPlanningCapacity(1,2,candidate)).toBe(0);
 for(const ceiling of [0,-1,NaN,Infinity,1.5,candidate.maxCacheBytes+1])
  expect(()=>materialPlanningCapacity(50,2,{...candidate,materialPlanningBytes:ceiling})).toThrow('MATERIAL_PLANNING_BUDGET');
});
test('retained Hayes workload fits only while shared live pressure remains bounded',()=>{
 const b=selectedDeviceBudget('auto',mobile),overhead=122338006;
 const resident=b.maxCacheBytes-overhead,transition=b.maxTransitionBytes!-overhead;
 expect(resident).toBe(229983530);expect(transition).toBe(347424042);
 const furnishing=7515676,retained=62122239,encoded=17874905,incoming=125357442;
 expect(retained+encoded+incoming).toBeGreaterThan(192*mib-overhead);
 expect(retained+encoded+incoming+furnishing).toBeLessThan(resident);
 const used=retained+encoded,peak=new AssetPeakBudget(transition,()=>used);
 peak.reserve('furnishings',furnishing);peak.reserve('parse',205541760);
 expect(peak.total()).toBe(used+furnishing+205541760);
 expect(()=>peak.reserve('peer',transition-peak.total()+1)).toThrow('ASSET_TRANSITION_PEAK');
 peak.release('parse');peak.release('furnishings');expect(peak.total()).toBe(used);
});
