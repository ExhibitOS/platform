// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {createOwnerFurnishingScene} from './owner-scene';
import {workspaceFailureObserver} from './failure-readout';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {AssetPeakBudget,DEVICE_BUDGETS,workspaceFurnishingModelPreflight} from '../viewer/loading';

vi.mock('../basis-loader',()=>({basisLoader:vi.fn(async()=>undefined)}));
afterEach(()=>vi.restoreAllMocks());
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(mode:'success'|'authority'|'descriptor'|'descriptor-encoding'|'fetch'|'integrity'|'bytes'|'replacement'|'scene'|'triangles'|'cancelled-triangles',count=2){
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),model={mime:'model/gltf-binary',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},item={id:id(2),version:1,kind:'bench',name:'Synthetic',rights:{permissions:{display:true}},provenance:'Synthetic',model},placements=Array.from({length:count},(_,i)=>({id:id(3+i),roomId:id(1),furnishingId:item.id,furnishingVersion:1,position:[1,0,1],yaw:0,scale:1})),candidate={rooms:[{id:id(1),dimensions:{width:10,height:3,depth:10}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[item],placements}}};
 const room=new three.Group(),scene=new three.Scene(),controller=new AbortController();scene.add(room);
 if(mode==='scene'){
  const plan=workspaceFurnishingModelPreflight(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),bytes.length,DEVICE_BUDGETS.desktop);
  for(let i=0;i<384-plan.draws;i++)scene.add(new three.Mesh(new three.BoxGeometry(),new three.MeshBasicMaterial()));
 }
 if(mode==='triangles'||mode==='cancelled-triangles'){const plan=workspaceFurnishingModelPreflight(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),bytes.length,DEVICE_BUDGETS.desktop);const geometry=new three.BufferGeometry();geometry.setAttribute('position',new three.BufferAttribute(new Float32Array((200000-(mode==='cancelled-triangles'?1:plan.triangles))*9),3));scene.add(new three.Mesh(geometry,new three.MeshBasicMaterial()));}
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/display-check')?(mode==='authority'?new Response(null,{status:403}):mode==='descriptor-encoding'?new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}):Response.json(mode==='descriptor'?{...item,name:'Changed'}:item)):(mode==='fetch'?new Response(null,{status:404}):new Response(new Uint8Array(mode==='integrity'?new Uint8Array(bytes.length):bytes),{headers:{'content-type':'model/gltf-binary'}})));
 let unavailable=false;const runtime=createOwnerFurnishingScene({three,renderer:{} as three.WebGLRenderer,scene,rooms:new Map([[id(1),room]]),candidate,tenantId:id(999),signal:controller.signal,unavailable:()=>unavailable,budget:DEVICE_BUDGETS.desktop,transitionBytes:mode==='bytes'?bytes.length*4-1:mode==='replacement'?bytes.length*4+1:64*1024*1024,nativeEditor:true,resident:()=>0,changed:()=>{},fetcher});
 return {runtime,room,scene,controller,fetcher,bytes,item,setUnavailable:(value:boolean)=>{unavailable=value;}};
}
it.each([
 ['authority','display-check','WORKSPACE_MODEL_AUTHORITY',403],
 ['descriptor','descriptor-match','WORKSPACE_MODEL_AUTHORITY',200],
 ['descriptor-encoding','descriptor-match','WORKSPACE_MODEL_AUTHORITY',200],
 ['fetch','model-fetch','WORKSPACE_MODEL_FETCH',404],
 ['integrity','integrity','WORKSPACE_MODEL_INTEGRITY',200],
] as const)('attributes %s to the first failure before cleanup without changing fallback or counts',async(mode,stage,code,status)=>{
 const f=await fixture(mode);try{
  expect(f.runtime.readout()).toMatchObject({settled:false,loaded:0,failed:0,failures:[]});
  expect(await f.runtime.start()).toEqual({loaded:0,failed:2});
  const readout=f.runtime.readout();expect(readout).toMatchObject({version:1,settled:true,loaded:0,failed:2,truncated:false});expect(readout.failures).toHaveLength(2);
  for(const [i,row] of readout.failures.entries()){
   expect(row).toMatchObject({placementId:id(3+i),furnishingId:f.item.id,furnishingVersion:1,modelSha256:f.item.model.sha256,stage,code,httpStatus:status,bytesReserved:f.bytes.length*4,bytesUsed:f.bytes.length*4,requestedBytes:null});
   expect(row.httpKind).toBe(mode==='authority'||mode==='descriptor'||mode==='descriptor-encoding'?'display-check':'model');
  }
  expect(f.runtime.ledger.reservedBytes()).toBe(0);expect(f.room.children).toEqual([]);expect(f.runtime.trianglePressure()).toBeUndefined();
 }finally{f.runtime.dispose();}
});
it.each(['bytes','replacement'] as const)('retains the failed %s request before cleanup with the actual current model hold',async mode=>{
 const f=await fixture(mode);try{
  expect(await f.runtime.start()).toEqual({loaded:0,failed:2});
  const row=f.runtime.readout().failures[0]!;expect(row).toMatchObject({stage:'byte-reserve',code:'ASSET_TRANSITION_PEAK'});
  if(mode==='bytes'){expect(f.fetcher).not.toHaveBeenCalled();expect(row).toMatchObject({byteLimit:f.bytes.length*4-1,bytesUsed:0,bytesReserved:0,requestedBytes:f.bytes.length*4,httpKind:null,httpStatus:null});}
  else{expect(row).toMatchObject({byteLimit:f.bytes.length*4+1,bytesUsed:f.bytes.length*4,bytesReserved:f.bytes.length*4,httpKind:'model',httpStatus:200});expect(row.requestedBytes).toBeGreaterThan(row.byteLimit);}
  expect(row.bytesUsed-row.bytesReserved+row.requestedBytes!).toBeGreaterThan(row.byteLimit);
  expect(f.runtime.ledger.reservedBytes()).toBe(0);expect(f.runtime.trianglePressure()).toBeUndefined();
 }finally{f.runtime.dispose();}
});
it('reports actual remaining scene capacity and loaded model hold before a mount reservation is released',async()=>{
 const f=await fixture('scene');try{
  expect(await f.runtime.start()).toEqual({loaded:1,failed:1});const row=f.runtime.readout().failures[0]!;
  expect(row).toMatchObject({placementId:id(4),stage:'scene-reserve',code:'WORKSPACE_SCENE_BUDGET',remainingDraws:0,requestedDraws:1,requestedBytes:null});
  expect(row.bytesReserved).toBeGreaterThan(f.bytes.length*4);expect(row.bytesUsed).toBe(row.bytesReserved*2);
  expect(f.runtime.ledger.reservedBytes()).toBe(row.bytesReserved);expect(f.room.children).toHaveLength(1);
 }finally{f.runtime.dispose();for(const child of f.scene.children)if(child instanceof three.Mesh){child.geometry.dispose();(child.material as three.Material).dispose();}}
});
it('exposes only actual triangle-only aggregate demand after the full initial sequence settles',async()=>{
 const f=await fixture('triangles');try{
  expect(f.runtime.trianglePressure()).toBeUndefined();expect(await f.runtime.start()).toEqual({loaded:1,failed:1});
  const row=f.runtime.readout().failures[0]!,pressure=f.runtime.trianglePressure()!;
  expect(pressure.missingTriangles).toBe(row.requestedTriangles!-row.remainingTriangles);expect(pressure.missingTriangles).toBeGreaterThan(0);expect(pressure.missingDraws).toBeLessThan(0);f.setUnavailable(true);expect(f.runtime.trianglePressure()).toBeUndefined();f.setUnavailable(false);expect(f.runtime.trianglePressure()).toEqual(pressure);
 }finally{f.runtime.dispose();for(const child of f.scene.children)if(child instanceof three.Mesh){if(child instanceof three.InstancedMesh)child.dispose();child.geometry.dispose();(child.material as three.Material).dispose();}}
});
it('cannot plan from a partial aborted sequence with an earlier triangle refusal',async()=>{
 const f=await fixture('cancelled-triangles'),original=f.fetcher.getMockImplementation()!;let waiting=false;
 f.fetcher.mockImplementation(async input=>{
  if(String(input).endsWith('/display-check')&&f.runtime.readout().failed===1){waiting=true;return new Promise<Response>((_resolve,reject)=>{const abort=()=>reject(f.controller.signal.reason);if(f.controller.signal.aborted)abort();else f.controller.signal.addEventListener('abort',abort,{once:true});});}
  return original(input);
 });
 try{
  const started=f.runtime.start();await vi.waitFor(()=>expect(waiting).toBe(true));f.controller.abort();expect(await started).toEqual({loaded:0,failed:1});
  expect(f.runtime.readout()).toMatchObject({settled:true,failed:1});expect(f.runtime.readout().failures).toHaveLength(1);expect(f.runtime.trianglePressure()).toBeUndefined();
 }finally{f.runtime.dispose();for(const child of f.scene.children)if(child instanceof three.Mesh){child.geometry.dispose();(child.material as three.Material).dispose();}}
});
it('caps retained output at 32 unique first failures with truthful totals and truncation',async()=>{
 const f=await fixture('authority',33);try{
  expect(await f.runtime.start()).toEqual({loaded:0,failed:33});const readout=f.runtime.readout();expect(readout.failures).toHaveLength(32);expect(new Set(readout.failures.map(row=>row.placementId)).size).toBe(32);expect(readout).toMatchObject({settled:true,loaded:0,failed:33,truncated:true});expect(Buffer.byteLength(JSON.stringify(readout))).toBeLessThanOrEqual(32768);
 }finally{f.runtime.dispose();}
});
it('never forwards arbitrary exception text or lets diagnostic recording alter the original failure',()=>{
 const scope=new OwnerPreviewBudget(id(999),fetch,4,100),ledger=new AssetPeakBudget(1000,()=>7),record=vi.fn(),observer=workspaceFailureObserver(scope,ledger,1000,record);
 observer.stage('decode');observer.failure(new TypeError('secret URL or body'));expect(record.mock.calls[0]![0]).toMatchObject({stage:'decode',code:'OTHER_FAILURE',bytesUsed:7});expect(JSON.stringify(record.mock.calls)).not.toContain('secret');
 const broken=workspaceFailureObserver(scope,ledger,1000,()=>{throw Error('diagnostic consumer');});expect(()=>broken.failure(Error('WORKSPACE_MODEL_AUTHORITY'))).not.toThrow();
});
