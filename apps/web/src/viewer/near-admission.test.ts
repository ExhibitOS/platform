// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute} from 'three';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {residentMinimumFits} from './resident-minimum-wait';
import {detailResidentRetryReady} from './borrowed-detail-preview';
import {materialPlanningCapacity,stagingHayesDetailBudget,modelDecodeReserve,deviceBudget,selectedDeviceBudget,DEVICE_BUDGETS,DESKTOP_NEAR_BUDGET,modelGeometryResidentBytes,geometryResidentBytes,textureResidentBytes,AssetPeakBudget,MemoryAssetCache,retainEncodedBuffer} from './loading';

test('near geometry is an explicit existing quality choice with known-low-memory fallback',()=>{
 expect(selectedDeviceBudget('auto',{viewportWidth:1400})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('auto',{viewportWidth:1400,deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('compact',{viewportWidth:1400,deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:128*1024*1024,maxTransitionBytes:160*1024*1024,maxSceneTriangles:100000});
 expect(selectedDeviceBudget('desktop',{viewportWidth:390,deviceMemory:8})).toMatchObject({...DESKTOP_NEAR_BUDGET,maxCacheBytes:256*1024*1024,maxTransitionBytes:320*1024*1024});
 expect(selectedDeviceBudget('desktop',{viewportWidth:1400,deviceMemory:4})).toEqual(DEVICE_BUDGETS.desktop);
 const near=selectedDeviceBudget('desktop',{viewportWidth:1400});expect(near.maxTriangles).toBe(250000);expect(near.maxTextureSize).toBe(2048);expect(near.maxCacheBytes).toBe(192*1024*1024);expect(near.maxTransitionBytes).toBe(256*1024*1024);
});
test('automatic headroom uses bounded residency and transition limits in known memory classes',()=>{
 const mib=1024*1024;
 expect(deviceBudget({deviceMemory:4})).toEqual({...DEVICE_BUDGETS.compact,maxCacheBytes:48*mib,maxTransitionBytes:64*mib});
 expect(deviceBudget({deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*mib,maxTransitionBytes:256*mib});
 expect(deviceBudget({deviceMemory:8,coarsePointer:false,finePointer:true})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:320*mib,maxTransitionBytes:416*mib,maxTriangles:150000});
 expect(deviceBudget({deviceMemory:8,coarsePointer:true,finePointer:true})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*mib,maxTransitionBytes:256*mib});
 for(const memory of [undefined,2,Infinity,NaN])expect(deviceBudget({deviceMemory:memory}).maxTransitionBytes).toBeUndefined();
 expect(selectedDeviceBudget('compact',{deviceMemory:4})).toEqual(deviceBudget({deviceMemory:4}));
 expect(selectedDeviceBudget('compact',{deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 for(const memory of [undefined,2,3,Infinity,NaN])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toEqual(DEVICE_BUDGETS.compact);
 for(const memory of [4,6])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:48*mib,maxTransitionBytes:64*mib});
 for(const memory of [8,16])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:128*mib,maxTransitionBytes:160*mib,maxSceneTriangles:100000});
});
test('known-memory Compact can admit the measured model phase without enlarging model quality limits',()=>{
 const compact=selectedDeviceBudget('compact',{deviceMemory:8});
 const sceneOverhead=48*1024*1024-36395656,used=28472922,cpuReserve=13942224;
 expect(used+8763010).toBeGreaterThan(36395656);
 const peak=new AssetPeakBudget(compact.maxTransitionBytes!-sceneOverhead,()=>used);
 expect(()=>peak.reserve('model',cpuReserve)).not.toThrow();
 expect(compact.maxTriangles).toBe(20000);expect(compact.maxTextureSize).toBe(512);
 expect(compact.maxCacheBytes-sceneOverhead).toBeGreaterThan(used+8763010);
 peak.release('model');expect(peak.total()).toBe(used);
});
test('touch auto without a memory hint uses bounded steady and transition headroom',()=>{
 const touch={coarsePointer:true};
 expect(deviceBudget(touch)).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024});
 expect(deviceBudget({...touch,deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(deviceBudget({coarsePointer:false})).toEqual(DEVICE_BUDGETS.desktop);
 expect(deviceBudget({coarsePointer:false,finePointer:true})).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:320*1024*1024,maxTransitionBytes:416*1024*1024,maxTriangles:150000,maxSceneTriangles:200000});
 expect(deviceBudget({coarsePointer:true,finePointer:true})).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024});
 expect(deviceBudget({deviceMemory:2,coarsePointer:false,finePointer:true})).toEqual(DEVICE_BUDGETS.compact);
 expect(deviceBudget({coarsePointer:false,finePointer:false})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('compact',touch)).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('desktop',touch)).toEqual(DESKTOP_NEAR_BUDGET);
});
test('a narrow canvas cannot classify the same capacity as a lower-memory device',()=>{
 for(const deviceMemory of [undefined,2,4,8]){
  const wide={viewportWidth:1280,deviceMemory},narrow={viewportWidth:461,deviceMemory};
  expect(deviceBudget(narrow)).toEqual(deviceBudget(wide));
  expect(selectedDeviceBudget('desktop',narrow)).toEqual(selectedDeviceBudget('desktop',wide));
 }
 expect(deviceBudget({deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(deviceBudget({})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('compact',{deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:128*1024*1024,maxTransitionBytes:160*1024*1024,maxSceneTriangles:100000});
});
test('an explicit image allowance never lifts ordinary budgets or unknown/constrained memory',()=>{
 for(const deviceMemory of [undefined,2,4,Infinity,NaN]){
  expect(deviceBudget({deviceMemory}).selectedImage).toBeUndefined();
  expect(selectedDeviceBudget('compact',{deviceMemory}).selectedImage).toBeUndefined();
 }
 const {selectedImage,...ordinary}=selectedDeviceBudget('compact',{deviceMemory:8});
 expect(ordinary).toEqual({...DEVICE_BUDGETS.compact,maxCacheBytes:128*1024*1024,maxTransitionBytes:160*1024*1024,maxSceneTriangles:100000});
 expect(selectedImage).toEqual({maxCacheBytes:128*1024*1024,maxTransitionBytes:160*1024*1024});
 const near=selectedDeviceBudget('desktop',{deviceMemory:8});
 expect(near.selectedImage?.maxCacheBytes).toBe(near.maxCacheBytes);
 expect(near.selectedImage?.maxTransitionBytes).toBe(near.maxTransitionBytes);
});
test('a selected request ceiling shares every allocation without growing the ordinary ceiling',()=>{
 let resident=40;const peak=new AssetPeakBudget(60,()=>resident);
 peak.reserve('selected',50,100);expect(peak.total()).toBe(90);
 expect(()=>peak.reserve('ordinary',1)).toThrow('ASSET_TRANSITION_PEAK');
 peak.reserve('peer',10,100);expect(()=>peak.reserve('peer',11,100)).toThrow('ASSET_TRANSITION_PEAK');
 peak.release('selected');peak.release('peer');resident=59;
 peak.reserve('ordinary',1);expect(()=>peak.reserve('ordinary',2)).toThrow('ASSET_TRANSITION_PEAK');
 expect(()=>peak.reserve('invalid',1,Infinity)).toThrow('ASSET_TRANSITION_PEAK');
});

// Header/cost observations only. This does not qualify the retained Old Arrow
// files, which still have independent format/topology/pair admission blockers.
function arrowGeometry(){const sizes=[84478*12,84478*12,84478*8,450000*4];let offset=0;return {accessors:sizes.map((_,i)=>({bufferView:i,count:i===3?450000:84478,type:i===3?'SCALAR':i===2?'VEC2':'VEC3',componentType:i===3?5125:5126})),bufferViews:sizes.map(byteLength=>{const value={byteOffset:offset,byteLength};offset+=byteLength;return value;}),meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3}]}]};}
test('150k indexed geometry charges actual CPU backing and GPU copies, not per-triangle duplicated vertices',()=>{
 const doc=arrowGeometry(),bin=4503296;expect(modelGeometryResidentBytes(doc,bin)).toBe(9006592);
 doc.meshes[0]!.primitives.push(doc.meshes[0]!.primitives[0]!);expect(modelGeometryResidentBytes(doc,bin)).toBe(9006592);
 const bad=arrowGeometry();bad.bufferViews[0]!.byteLength--;expect(()=>modelGeometryResidentBytes(bad,bin)).toThrow('DECODE_BUDGET_EXCEEDED');
 const missing=arrowGeometry();missing.accessors[0]!.bufferView=99;expect(()=>modelGeometryResidentBytes(missing,bin)).toThrow('DECODE_BUDGET_EXCEEDED');
 const geometry=9006592;
 expect(geometry+3*textureResidentBytes(2048,2048)).toBeGreaterThan(DEVICE_BUDGETS.desktop.maxCacheBytes);
 expect(geometry+3*textureResidentBytes(2048,2048)).toBeLessThan(DESKTOP_NEAR_BUDGET.maxCacheBytes);
 expect(geometry+3*textureResidentBytes(4096,4096)).toBeGreaterThan(DESKTOP_NEAR_BUDGET.maxCacheBytes);
 expect(geometry+textureResidentBytes(2048,2048)+2*textureResidentBytes(1024,1024)).toBeLessThan(DESKTOP_NEAR_BUDGET.maxCacheBytes);
});
test('current and nearby work share one bounded transition allowance while resident capacity stays separate',()=>{
 const resident=32*1024*1024,peak=new AssetPeakBudget(DESKTOP_NEAR_BUDGET.maxTransitionBytes!,()=>resident);
 peak.reserve('current',180*1024*1024);expect(()=>peak.reserve('nearby',60*1024*1024)).toThrow('ASSET_TRANSITION_PEAK');
 peak.release('current');peak.reserve('nearby',60*1024*1024);expect(peak.total()).toBe(92*1024*1024);expect(DESKTOP_NEAR_BUDGET.maxCacheBytes).toBe(192*1024*1024);
});

test('committed residency counts distinct GPU attributes sharing CPU bytes and shared interleaved uploads once',()=>{
 const array=new Float32Array(12),a=new BufferAttribute(array,3),b=new BufferAttribute(array,3);
 expect(geometryResidentBytes([a,b,a])).toBe(array.byteLength*3);
 const data=new InterleavedBuffer(new Float32Array(24),6),position=new InterleavedBufferAttribute(data,3,0),normal=new InterleavedBufferAttribute(data,3,3);
 expect(geometryResidentBytes([position,normal])).toBe(data.array.byteLength*2);
});

// A representative allocation boundary, not a measured external model/scene fit.
test('candidate keeps backing, encoded coexistence and minimum scene charged before allowing a detail transition',()=>{
 const mib=1024*1024,encodedBytes=17963452,geometryBytes=9116928,textures=3*textureResidentBytes(2048,2048),minimum=28*mib,external=18*mib;
 const steady=DESKTOP_NEAR_BUDGET.maxCacheBytes-external,transition=DESKTOP_NEAR_BUDGET.maxTransitionBytes!-external;
 const cache=new MemoryAssetCache<ArrayBuffer>(steady),input=new ArrayBuffer(encodedBytes),rewritten=new ArrayBuffer(encodedBytes);cache.set('detail',input,input.byteLength);
 const backing=retainEncodedBuffer(cache,'detail',rewritten);expect(backing.retainedBytes).toBe(encodedBytes);
 let oldDetail=32*mib;const peak=new AssetPeakBudget(transition,()=>minimum+oldDetail+cache.stats().bytes),decode=encodedBytes*5+geometryBytes+textures;
 expect(()=>peak.reserve('detail',Math.ceil(decode))).toThrow('ASSET_TRANSITION_PEAK');
 oldDetail=0;expect(()=>peak.reserve('detail',Math.ceil(decode))).toThrow('ASSET_TRANSITION_PEAK');
 expect(cache.delete('detail')).toBe(true);peak.reserve('detail',Math.ceil(decode));expect(peak.total()).toBeLessThanOrEqual(transition);
 const committed=minimum+geometryBytes+textures+backing.retainedBytes;expect(committed).toBeLessThan(steady);expect(committed+32*mib).toBeGreaterThan(steady);
 peak.release('detail');backing.dispose();
});

 test('explicit Desktop uses the qualified envelope and retains its triangle limit',()=>{
  const input={coarsePointer:false,finePointer:true},mib=1024*1024;
  expect(selectedDeviceBudget('desktop',input)).toMatchObject({maxCacheBytes:320*mib,maxTransitionBytes:416*mib,maxTriangles:250000,maxTextureSize:2048});
  expect(selectedDeviceBudget('compact',input)).toEqual(DEVICE_BUDGETS.compact);
 });


test('bounds the exact Hayes selected-detail staging trial with the original scene ledger',async()=>{
 const assetSha256='694a9cf81dfbf12fd0841ae45240c5ae0f1d7cb129d0ee122be7cff86c4625bc';
 const indexSha256='054b6756a6aa468e25eaa634b84800fb01d3b21d11f0fff6075f5d54291e8d68';
 const touch={coarsePointer:true,finePointer:false},budget=selectedDeviceBudget('auto',touch);
 const input={enabled:true,indexSha256,assetSha256,...touch,budget};
 const trial=stagingHayesDetailBudget(input)!;
 expect(trial).toEqual({...budget,maxCacheBytes:256*1024*1024,maxTransitionBytes:272*1024*1024});
 for(const patch of [{enabled:false},{indexSha256:'wrong'},{assetSha256:'wrong'},{deviceMemory:4},{finePointer:true},{budget:selectedDeviceBudget('compact',touch)},{budget:selectedDeviceBudget('desktop',touch)}])
  expect(stagingHayesDetailBudget({...input,...patch})).toBeUndefined();
 const model=await readFile(new URL('../../../../demos/reference-exhibition/source/data/'+assetSha256+'.bin',import.meta.url));
 expect(createHash('sha256').update(model).digest('hex')).toBe(assetSha256);
 const effectiveResident=130219146,effectiveTransition=197328010,retained=62122239+2048;
 const residentLimit=effectiveResident+trial.maxCacheBytes-budget.maxCacheBytes;
 const transitionLimit=effectiveTransition+trial.maxTransitionBytes!-budget.maxTransitionBytes!;
 const cpu=modelDecodeReserve(model.length,{...budget,maxCacheBytes:residentLimit},new Uint8Array(model).buffer,2048,'cpu');
 expect(cpu).toBe(138432896);
 const ledger=new AssetPeakBudget(effectiveTransition,()=>retained);
 expect(()=>ledger.reserve('parse',cpu)).toThrow('ASSET_TRANSITION_PEAK');
 const retry=()=>detailResidentRetryReady(cpu,ledger.total(),effectiveTransition,0);
 expect(retry()).toBe(false);
 expect(retry()).toBe(false);
 expect(detailResidentRetryReady(cpu,ledger.total(),effectiveTransition,200557183-effectiveTransition-1)).toBe(false);
 expect(detailResidentRetryReady(cpu,ledger.total(),effectiveTransition,200557183-effectiveTransition)).toBe(true);
 ledger.reserve('parse',cpu,transitionLimit);
 expect(ledger.total()).toBe(200557183);
 ledger.release('parse');
 const decoded=7916928+3*textureResidentBytes(2048,2048);
 expect(retained+decoded).toBeGreaterThan(effectiveResident);
 expect(retained+decoded).toBeLessThan(residentLimit);
});

test('touch Auto admits the modeled Hayes 1024 retry without charging the probe to the ledger',()=>{
 const stagedLimit=71367818,stagedDeductions=134217728-stagedLimit,decode1024=39303428;
 const currentLimit=deviceBudget({coarsePointer:true}).maxTransitionBytes!-stagedDeductions;
 const resident=61936394;
 const observed:number[]=[];
 const peak=new AssetPeakBudget(stagedLimit,()=>resident,total=>observed.push(total));
 expect(()=>peak.assertFits('model',decode1024)).toThrow('ASSET_TRANSITION_PEAK');
 peak.assertFits('model',decode1024,currentLimit);
 expect(peak.total()).toBe(resident);
 expect(observed).toEqual([]);
 peak.reserve('model',decode1024,currentLimit);
 expect(observed).toEqual([101239822]);
});

test('known high-memory Compact leaves headroom after observed reservations while preserving pressure bounds',()=>{
 const mib=1024*1024,configuredBefore=96*mib,effectiveBefore=54461738;
 const sceneReservations=configuredBefore-effectiveBefore;
 const residentAtAdmission=43057468,required=7649468;
 expect(effectiveBefore-residentAtAdmission-required).toBe(3754802);
 const candidate=selectedDeviceBudget('compact',{deviceMemory:8});
 const effective=candidate.maxCacheBytes-sceneReservations;
 expect(effective).toBe(88016170);
 expect(effective-residentAtAdmission-required).toBeGreaterThan(32*mib);
 expect(residentMinimumFits(residentAtAdmission,required,effective)).toBe(true);
 expect(residentMinimumFits(effective,required,effective)).toBe(false);
 const live=new AssetPeakBudget(candidate.maxTransitionBytes!-sceneReservations,()=>residentAtAdmission);
 live.reserve('minimum',required);
 expect(live.total()).toBe(residentAtAdmission+required);
 expect(()=>live.reserve('over-pressure',candidate.maxTransitionBytes!)).toThrow('ASSET_TRANSITION_PEAK');
 expect(live.total()).toBe(residentAtAdmission+required);
 expect(candidate).toMatchObject({maxTriangles:20000,maxSceneTriangles:100000,maxTextureSize:512,maxPixelRatio:1,concurrency:2});
 for(const memory of [undefined,2,4,6,NaN,Infinity])expect(selectedDeviceBudget('compact',{deviceMemory:memory}).maxSceneTriangles).toBeUndefined();
});

test('no-hint minimum trial is opt-in and preserves known-memory and weaker-device policies',()=>{
 for(const profile of ['auto','compact','desktop'] as const){
  for(const deviceMemory of [2,4,6,8,16,NaN,Infinity]){
   const input={deviceMemory,coarsePointer:true,finePointer:false};
   expect(selectedDeviceBudget(profile,input,true)).toEqual(selectedDeviceBudget(profile,input));
  }
 }
 const input={coarsePointer:true,finePointer:false};
 expect(selectedDeviceBudget('compact',input)).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('compact',input,true)).toEqual({...DEVICE_BUDGETS.compact,maxCacheBytes:128*1024*1024,maxTransitionBytes:160*1024*1024,maxSceneTriangles:100000});
 expect(selectedDeviceBudget('auto',input,true)).toEqual({...selectedDeviceBudget('auto',input),maxSceneTriangles:200000});
 const ordinaryScene=94507-20000+100000;
 expect(ordinaryScene).toBeGreaterThan(selectedDeviceBudget('auto',input).maxTriangles);
 expect(ordinaryScene).toBeLessThan(selectedDeviceBudget('auto',input,true).maxSceneTriangles!);
 expect(selectedDeviceBudget('desktop',input,true)).toEqual(selectedDeviceBudget('desktop',input));
});
test('desktop-like no-hint trial separates aggregate headroom from asset eligibility and live pressure',()=>{
 const input={coarsePointer:false,finePointer:true};
 for(const profile of ['auto','desktop'] as const){
  const baseline=selectedDeviceBudget(profile,input),trial=selectedDeviceBudget(profile,input,true);
  expect(trial).toEqual({...baseline,maxSceneTriangles:400000});
  expect(trial.maxCacheBytes).toBe(320*1024*1024);expect(trial.maxTransitionBytes).toBe(416*1024*1024);
  const aggregate=94493+2*150000;
  expect(aggregate).toBeGreaterThan(baseline.maxSceneTriangles??baseline.maxTriangles);
  expect(aggregate).toBeLessThan(trial.maxSceneTriangles!);
  const ledger=new AssetPeakBudget(trial.maxTransitionBytes!,()=>trial.maxCacheBytes);
  expect(()=>ledger.reserve('actual-pressure',97*1024*1024)).toThrow('ASSET_TRANSITION_PEAK');
  expect(ledger.reservedBytes()).toBe(0);
 }
 expect(selectedDeviceBudget('auto',{},true)).toEqual(selectedDeviceBudget('auto',{}));
});

test('resident headroom requires both bits and preserves all known or invalid hints',()=>{
 for(const profile of ['auto','compact','desktop'] as const)for(const input of [{},{coarsePointer:true,finePointer:false},{coarsePointer:false,finePointer:true}]){
  expect(selectedDeviceBudget(profile,input,false,true)).toEqual(selectedDeviceBudget(profile,input));
  for(const deviceMemory of [-Infinity,-1,0,2,4,6,8,16,NaN,Infinity]){
   expect(selectedDeviceBudget(profile,{...input,deviceMemory},true,true)).toEqual(selectedDeviceBudget(profile,{...input,deviceMemory}));
  }
 }
});
test('headroom changes only byte ceilings and freezes control material planning',()=>{
 const mib=1024*1024;
 for(const input of [{coarsePointer:true,finePointer:false},{coarsePointer:true,finePointer:true},{coarsePointer:false,finePointer:true}])for(const profile of ['auto','desktop'] as const){
  const control=selectedDeviceBudget(profile,input,true),candidate=selectedDeviceBudget(profile,input,true,true);
  const fineOnly=!input.coarsePointer;
  expect(candidate).toEqual({...control,maxCacheBytes:(fineOnly?512:336)*mib,maxTransitionBytes:(fineOnly?640:448)*mib,materialPlanningBytes:control.maxCacheBytes});
  const reservations=122338006,frame=mib;
  expect(materialPlanningCapacity(candidate.maxCacheBytes-reservations,frame,candidate)).toBe(materialPlanningCapacity(control.maxCacheBytes-reservations,frame,control));
  expect(selectedDeviceBudget('compact',input,true,true)).toEqual(selectedDeviceBudget('compact',input,true));
 }
 expect(selectedDeviceBudget('auto',{},true,true)).toEqual(selectedDeviceBudget('auto',{},true));
});
test('material planning ceiling validates its bounded optional capacity',()=>{
 expect(materialPlanningCapacity(100,10)).toBe(90);
 expect(materialPlanningCapacity(5,10,{maxCacheBytes:100})).toBe(0);
 expect(materialPlanningCapacity(100,10,{maxCacheBytes:100,materialPlanningBytes:100})).toBe(90);
 expect(materialPlanningCapacity(5,10,{maxCacheBytes:100,materialPlanningBytes:50})).toBe(0);
 for(const materialPlanningBytes of [0,-1,NaN,Infinity,1.5,101,Number.MAX_SAFE_INTEGER+1])expect(()=>materialPlanningCapacity(100,10,{maxCacheBytes:100,materialPlanningBytes})).toThrow('MATERIAL_PLANNING_BUDGET');
});
test('measured ordinary model and retained cache fit headroom after worst observed holds while live pressure stays charged',()=>{
 const input={coarsePointer:true,finePointer:false},control=selectedDeviceBudget('auto',input,true),candidate=selectedDeviceBudget('auto',input,true,true);
 const reservations=122338006,retained=62122239+17874905,modelResident=7916928+117440512,completeReserve=205541760;
 expect(modelResident).toBe(125357440);expect(retained+modelResident).toBe(205354584);
 expect(control.maxCacheBytes-reservations).toBe(78988586);
 const effective=candidate.maxCacheBytes-reservations;
 expect(effective).toBe(229983530);expect(effective-retained-modelResident).toBe(24628946);
 expect(residentMinimumFits(retained,modelResident,control.maxCacheBytes-reservations)).toBe(false);
 expect(residentMinimumFits(retained,modelResident,effective)).toBe(true);
 const transition=candidate.maxTransitionBytes!-reservations;expect(transition).toBe(347424042);
 const live=new AssetPeakBudget(transition,()=>retained);
 live.reserve('model-complete',completeReserve);expect(live.total()).toBe(retained+completeReserve);
 expect(()=>live.reserve('pressure',transition-retained-completeReserve+1)).toThrow('ASSET_TRANSITION_PEAK');
 expect(live.total()).toBe(retained+completeReserve);
 expect(residentMinimumFits(effective,modelResident,effective)).toBe(false);
});
test('desktop two-model cost arithmetic remains synthetic and per-asset geometry is unchanged',()=>{
 const input={coarsePointer:false,finePointer:true};
 for(const profile of ['auto','desktop'] as const){
  const control=selectedDeviceBudget(profile,input,true),candidate=selectedDeviceBudget(profile,input,true,true);
  const effective=candidate.maxCacheBytes-155368150;
  expect(effective).toBe(381502762);
  expect(2*125357440).toBeLessThan(effective);
  expect(candidate.maxSceneTriangles).toBe(400000);expect(candidate.maxTriangles).toBe(control.maxTriangles);
 }
});
