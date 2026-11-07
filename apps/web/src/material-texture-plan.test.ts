// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {materialMapPlan,materialPhaseBytes,type MaterialMapCost} from './material-texture-plan';
const files:MaterialMapCost[]=[{role:'color',bytes:1810870,width:2048,height:2048},{role:'normal',bytes:2397933,width:2048,height:2048},{role:'roughness',bytes:700000,width:2048,height:2048}];
test('only completed map loading releases transient bytes and retains styled geometry',()=>{
 const plan={...materialMapPlan(files,2048,96*1024*1024),geometryReserve:1824};plan.reserveBytes+=1824;
 expect(materialPhaseBytes(plan,false)).toBe(plan.reserveBytes);
 expect(materialPhaseBytes(plan,true)).toBe(plan.residentBytes+1824);
 expect(materialPhaseBytes(plan,true)).toBeLessThan(materialPhaseBytes(plan,false));
});
test('desktop reserves full original decoding and all roles with separate scalar resolution',()=>{
 const plan=materialMapPlan(files,2048,96*1024*1024);
 expect(plan.blocked).toBe(false);expect(plan.sizes).toHaveLength(3);
 expect(plan.sizes[0]).toBe(plan.sizes[1]);expect(plan.sizes[2]).toBe(plan.sizes[0]!/2);
 expect(plan.reserveBytes).toBeLessThanOrEqual(Math.floor(96*1024*1024*.65));
 expect(plan.reserveBytes-plan.residentBytes).toBeGreaterThanOrEqual(2048*2048*4+3*2397933);
});
test('a mobile budget never hides the cost of decoding a full original or drops a role',()=>{
 const plan=materialMapPlan(files,512,24*1024*1024);
 expect(plan).toEqual({sizes:[],reserveBytes:0,residentBytes:0,blocked:true});
 expect(materialMapPlan([],512,1)).toEqual({sizes:[],reserveBytes:0,residentBytes:0,blocked:false});
 expect(materialMapPlan(files,NaN,1).blocked).toBe(true);
});

test('serial phase reservation retains both geometry and the larger future peak',async()=>{
 const {serialMaterialPhaseBytes,loadMaterialPhases}=await import('./material-texture-plan');
 const floor={reserveBytes:51,residentBytes:29},surface={reserveBytes:35,residentBytes:8,geometryReserve:1};
 expect(serialMaterialPhaseBytes(floor,surface,false,false)).toBe(64);
 expect(serialMaterialPhaseBytes(floor,surface,true,false)).toBe(64);
 expect(serialMaterialPhaseBytes(floor,surface,true,true)).toBe(38);
 expect(()=>serialMaterialPhaseBytes(floor,surface,false,true)).toThrow('MATERIAL_PHASE_ORDER');
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),events:string[]=[];
 const running=loadMaterialPhases(async()=>{events.push('floor-start');await wait;events.push('floor-end');},async()=>{events.push('surface-start');},phase=>events.push(phase+'-released'),()=>false);
 await Promise.resolve();expect(events).toEqual(['floor-start']);release();await running;
 expect(events).toEqual(['floor-start','floor-end','floor-released','surface-start','surface-released']);
});
test('failure releases its hold and cancellation skips later work on every invocation',async()=>{
 const {loadMaterialPhases}=await import('./material-texture-plan');const events:string[]=[];let cancelled=false;
 await loadMaterialPhases(async()=>{events.push('floor');throw Error('failure');},async()=>{events.push('surface');},(p,e)=>events.push(p+(e?'-failed':'-released')),()=>cancelled);
 expect(events).toEqual(['floor','floor-failed','surface','surface-released']);events.length=0;
 await loadMaterialPhases(async()=>{events.push('floor');cancelled=true;},async()=>{events.push('unexpected');},p=>events.push(p+'-released'),()=>cancelled);
 expect(events).toEqual(['floor','floor-released','surface-released']);events.length=0;cancelled=false;
 await loadMaterialPhases(async()=>events.push('new-floor'),async()=>events.push('new-surface'),p=>events.push(p+'-released'),()=>cancelled);
 expect(events).toEqual(['new-floor','floor-released','new-surface','surface-released']);
});
test('only admission blocked while material loads is deferred for a retry',async()=>{
 const {deferredByMaterialLoad}=await import('./material-texture-plan');
 for(const code of ['ASSET_TRANSITION_PEAK','MODEL_RESIDENT_BUDGET']){
  expect(deferredByMaterialLoad(code,false,false)).toBe(true);
  expect(deferredByMaterialLoad(code,true,false)).toBe(true);
  expect(deferredByMaterialLoad(code,true,true)).toBe(false);
 }
 expect(deferredByMaterialLoad('FORMAT_REJECTED',false,false)).toBe(false);
 expect(deferredByMaterialLoad('RIGHTS_DENIED',false,false)).toBe(false);
});
test('retry keeps pinned and manual work without reloading an abandoned observation',async()=>{
 const {materialRetryWanted}=await import('./material-texture-plan');
 const base={mapPinned:false,viewingPinned:false,manual:false,visible:false,eligible:false,current:false};
 expect(materialRetryWanted(base)).toBe(false);
 expect(materialRetryWanted({...base,mapPinned:true})).toBe(true);
 expect(materialRetryWanted({...base,viewingPinned:true})).toBe(true);
 expect(materialRetryWanted({...base,manual:true})).toBe(true);
 expect(materialRetryWanted({...base,eligible:true})).toBe(true);
 expect(materialRetryWanted({...base,manual:false})).toBe(false);
});
