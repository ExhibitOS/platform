// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import {BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute} from 'three';
import {deviceBudget,selectedDeviceBudget,DEVICE_BUDGETS,DESKTOP_NEAR_BUDGET,modelGeometryResidentBytes,geometryResidentBytes,textureResidentBytes,AssetPeakBudget,MemoryAssetCache,retainEncodedBuffer} from './loading';

test('near geometry is an explicit existing quality choice with known-low-memory fallback',()=>{
 expect(selectedDeviceBudget('auto',{viewportWidth:1400})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('auto',{viewportWidth:1400,deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('compact',{viewportWidth:1400,deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:64*1024*1024,maxTransitionBytes:80*1024*1024});
 expect(selectedDeviceBudget('desktop',{viewportWidth:390,deviceMemory:8})).toMatchObject({...DESKTOP_NEAR_BUDGET,maxCacheBytes:256*1024*1024,maxTransitionBytes:320*1024*1024});
 expect(selectedDeviceBudget('desktop',{viewportWidth:1400,deviceMemory:4})).toEqual(DEVICE_BUDGETS.desktop);
 const near=selectedDeviceBudget('desktop',{viewportWidth:1400});expect(near.maxTriangles).toBe(250000);expect(near.maxTextureSize).toBe(2048);expect(near.maxCacheBytes).toBe(192*1024*1024);expect(near.maxTransitionBytes).toBe(256*1024*1024);
});
test('automatic headroom uses bounded residency and transition limits in known memory classes',()=>{
 const mib=1024*1024;
 expect(deviceBudget({deviceMemory:4})).toEqual({...DEVICE_BUDGETS.compact,maxCacheBytes:48*mib,maxTransitionBytes:64*mib});
 expect(deviceBudget({deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*mib,maxTransitionBytes:256*mib});
 expect(deviceBudget({deviceMemory:8,coarsePointer:false,finePointer:true})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:256*mib,maxTransitionBytes:320*mib});
 expect(deviceBudget({deviceMemory:8,coarsePointer:true,finePointer:true})).toMatchObject({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*mib,maxTransitionBytes:256*mib});
 for(const memory of [undefined,2,Infinity,NaN])expect(deviceBudget({deviceMemory:memory}).maxTransitionBytes).toBeUndefined();
 expect(selectedDeviceBudget('compact',{deviceMemory:4})).toEqual(deviceBudget({deviceMemory:4}));
 expect(selectedDeviceBudget('compact',{deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 for(const memory of [undefined,2,3,Infinity,NaN])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toEqual(DEVICE_BUDGETS.compact);
 for(const memory of [4,6])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:48*mib,maxTransitionBytes:64*mib});
 for(const memory of [8,16])expect(selectedDeviceBudget('compact',{deviceMemory:memory})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:64*mib,maxTransitionBytes:80*mib});
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
 expect(deviceBudget(touch)).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:112*1024*1024,maxTransitionBytes:128*1024*1024});
 expect(deviceBudget({...touch,deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(deviceBudget({coarsePointer:false})).toEqual(DEVICE_BUDGETS.desktop);
 expect(deviceBudget({coarsePointer:false,finePointer:true})).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024});
 expect(deviceBudget({coarsePointer:true,finePointer:true})).toEqual({...DEVICE_BUDGETS.desktop,maxCacheBytes:112*1024*1024,maxTransitionBytes:128*1024*1024});
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
 expect(selectedDeviceBudget('compact',{deviceMemory:8})).toMatchObject({...DEVICE_BUDGETS.compact,maxCacheBytes:64*1024*1024,maxTransitionBytes:80*1024*1024});
});
test('an explicit image allowance never lifts ordinary budgets or unknown/constrained memory',()=>{
 for(const deviceMemory of [undefined,2,4,Infinity,NaN]){
  expect(deviceBudget({deviceMemory}).selectedImage).toBeUndefined();
  expect(selectedDeviceBudget('compact',{deviceMemory}).selectedImage).toBeUndefined();
 }
 const {selectedImage,...ordinary}=selectedDeviceBudget('compact',{deviceMemory:8});
 expect(ordinary).toEqual({...DEVICE_BUDGETS.compact,maxCacheBytes:64*1024*1024,maxTransitionBytes:80*1024*1024});
 expect(selectedImage).toEqual({maxCacheBytes:96*1024*1024,maxTransitionBytes:128*1024*1024});
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

test('staging touch transition trial is opt-in and leaves other choices unchanged',()=>{
 const touch={coarsePointer:true};expect(deviceBudget(touch).maxTransitionBytes).toBe(128*1024*1024);
 vi.stubGlobal('__EXHIBITOS_IPHONE12_TRANSITION_TRIAL__',true);try{expect(deviceBudget(touch).maxTransitionBytes).toBe(160*1024*1024);expect(deviceBudget({deviceMemory:2,...touch})).toEqual(DEVICE_BUDGETS.compact);expect(selectedDeviceBudget('compact',touch)).toEqual(DEVICE_BUDGETS.compact);}finally{vi.unstubAllGlobals();}
});
