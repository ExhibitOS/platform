// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute} from 'three';
import {deviceBudget,selectedDeviceBudget,DEVICE_BUDGETS,DESKTOP_NEAR_BUDGET,modelGeometryResidentBytes,geometryResidentBytes,textureResidentBytes,AssetPeakBudget,MemoryAssetCache,retainEncodedBuffer} from './loading';

test('near geometry is an explicit existing quality choice with known-low-memory fallback',()=>{
 expect(selectedDeviceBudget('auto',{viewportWidth:1400})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('auto',{viewportWidth:1400,deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('compact',{viewportWidth:1400,deviceMemory:8})).toEqual(DEVICE_BUDGETS.compact);
 expect(selectedDeviceBudget('desktop',{viewportWidth:390,deviceMemory:8})).toEqual(DESKTOP_NEAR_BUDGET);
 expect(selectedDeviceBudget('desktop',{viewportWidth:1400,deviceMemory:4})).toEqual(DEVICE_BUDGETS.desktop);
 const near=selectedDeviceBudget('desktop',{viewportWidth:1400});expect(near.maxTriangles).toBe(250000);expect(near.maxTextureSize).toBe(2048);expect(near.maxCacheBytes).toBe(192*1024*1024);expect(near.maxTransitionBytes).toBe(256*1024*1024);
});
test('a narrow canvas cannot classify the same capacity as a lower-memory device',()=>{
 for(const deviceMemory of [undefined,2,4,8]){
  const wide={viewportWidth:1280,deviceMemory},narrow={viewportWidth:461,deviceMemory};
  expect(deviceBudget(narrow)).toEqual(deviceBudget(wide));
  expect(selectedDeviceBudget('desktop',narrow)).toEqual(selectedDeviceBudget('desktop',wide));
 }
 expect(deviceBudget({deviceMemory:2})).toEqual(DEVICE_BUDGETS.compact);
 expect(deviceBudget({})).toEqual(DEVICE_BUDGETS.desktop);
 expect(selectedDeviceBudget('compact',{deviceMemory:8})).toEqual(DEVICE_BUDGETS.compact);
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
