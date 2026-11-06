// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {AssetPeakBudget,DEVICE_BUDGETS} from '../viewer/loading';
import {loadWorkspaceFurnishingModel} from './model-loader';
vi.mock('../basis-loader',()=>({basisLoader:vi.fn(async()=>undefined)}));
afterEach(()=>vi.unstubAllGlobals());
const descriptor=(bytes:Buffer)=>({mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const source=(bytes:Buffer)=>({check:vi.fn(async()=>{}),open:vi.fn(async()=>new Response(new Uint8Array(bytes),{headers:{'content-type':'model/gltf-binary'}}))});
const renderer={} as three.WebGLRenderer;
it('loads a verified model only under the shared budget and releases its geometry',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),authority=source(bytes),ledger=new AssetPeakBudget(64*1024*1024,()=>0),result=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),authority,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);
 expect(authority.check).toHaveBeenCalledTimes(3);expect(result.triangles).toBeGreaterThan(0);expect(ledger.total()).toBe(result.reserveBytes);const geometries:three.BufferGeometry[]=[];result.object.traverse(node=>{if(node instanceof three.Mesh)geometries.push(node.geometry);});const dispose=vi.spyOn(geometries[0]!,'dispose');result.dispose();result.dispose();expect(dispose).toHaveBeenCalledOnce();expect(ledger.total()).toBe(0);
});
it('keeps concurrent model reservations independent until each is disposed',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),ledger=new AssetPeakBudget(64*1024*1024,()=>0),a=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),source(bytes),new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger),b=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),source(bytes),new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);expect(ledger.total()).toBe(a.reserveBytes+b.reserveBytes);a.dispose();expect(ledger.total()).toBe(b.reserveBytes);b.dispose();expect(ledger.total()).toBe(0);
});
it('fails closed and returns its reservation when bytes or authority change',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),ledger=new AssetPeakBudget(64*1024*1024,()=>0),bad=source(bytes);await expect(loadWorkspaceFurnishingModel(three,renderer,{...descriptor(bytes),sha256:'0'.repeat(64)},bad,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger)).rejects.toThrow('WORKSPACE_MODEL_INTEGRITY');expect(ledger.total()).toBe(0);
 const lost=source(bytes);lost.check.mockResolvedValueOnce().mockRejectedValueOnce(Error('OWNER_LOST'));await expect(loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),lost,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger)).rejects.toThrow('OWNER_LOST');expect(ledger.total()).toBe(0);
 const small=new AssetPeakBudget(1,()=>0),never=source(bytes);await expect(loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),never,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,small)).rejects.toThrow('ASSET_TRANSITION_PEAK');expect(never.open).not.toHaveBeenCalled();expect(small.total()).toBe(0);
});
it('cancels a pending model stream and releases its reservation',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),controller=new AbortController(),cancel=vi.fn(),ledger=new AssetPeakBudget(64*1024*1024,()=>0),authority={check:vi.fn(async()=>{}),open:vi.fn(async()=>new Response(new ReadableStream({cancel}),{headers:{'content-type':'model/gltf-binary'}}))};
 const work=loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),authority,controller.signal,()=>false,DEVICE_BUDGETS.desktop,ledger);await vi.waitFor(()=>expect(authority.open).toHaveBeenCalledOnce());controller.abort();await expect(work).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();expect(ledger.total()).toBe(0);
});
it('uses model-local PNG handling for a validated embedded texture fixture',async()=>{
 const {publicPBRTexturedGLB}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicPBRTexturedGLB:()=>Buffer},bytes=publicPBRTexturedGLB(),close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2,height:2,close})));
 vi.stubGlobal('self',globalThis);const authority=source(bytes),ledger=new AssetPeakBudget(64*1024*1024,()=>0),loaded=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),authority,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);expect(loaded.triangles).toBeGreaterThan(0);loaded.dispose();expect(close).toHaveBeenCalled();expect(ledger.total()).toBe(0);
});
it('uses the embedded PNG fallback for a paired KTX2 fixture without a GPU transcoder',async()=>{
 const {publicTexturedGLB,publicTexturePNG,withPublicBasis}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicTexturedGLB:(options:{png:Buffer})=>Buffer;publicTexturePNG:(width:number,height:number)=>Buffer;withPublicBasis:(bytes:Buffer)=>Buffer},bytes=withPublicBasis(publicTexturedGLB({png:publicTexturePNG(8,8)})),close=vi.fn();vi.stubGlobal('self',globalThis);vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:8,height:8,close})));
 const authority=source(bytes),ledger=new AssetPeakBudget(64*1024*1024,()=>0),loaded=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),authority,new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);loaded.dispose();expect(close).toHaveBeenCalled();expect(ledger.total()).toBe(0);
});
it('bounds abort while sibling image decodes remain pending and keeps their reservation',async()=>{
 const {publicPBRTexturedGLB}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicPBRTexturedGLB:()=>Buffer},bytes=publicPBRTexturedGLB(),pending:Array<(value:unknown)=>void>=[],close=vi.fn(),controller=new AbortController(),ledger=new AssetPeakBudget(64*1024*1024,()=>0);vi.stubGlobal('self',globalThis);vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>pending.push(resolve))));const quiet=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{const work=loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),source(bytes),controller.signal,()=>false,DEVICE_BUDGETS.desktop,ledger);await vi.waitFor(()=>expect(pending.length).toBe(3));controller.abort();await expect(work).rejects.toThrow();expect(ledger.total()).toBeGreaterThan(0);for(const finish of pending)finish({width:2,height:2,close});await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(3));await vi.waitFor(()=>expect(ledger.total()).toBe(0));}finally{quiet.mockRestore();}
});
it('quarantines the budget after an image rejection while sibling decodes are unresolved',async()=>{
 const {publicPBRTexturedGLB}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicPBRTexturedGLB:()=>Buffer},bytes=publicPBRTexturedGLB(),pending:Array<{resolve:(value:unknown)=>void;reject:(reason:Error)=>void}>=[],close=vi.fn(),ledger=new AssetPeakBudget(64*1024*1024,()=>0);vi.stubGlobal('self',globalThis);vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))));const quiet=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{const work=loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),source(bytes),new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);await vi.waitFor(()=>expect(pending.length).toBe(3));pending[0]!.reject(Error('DECODE_FAILED'));await new Promise(resolve=>setTimeout(resolve,0));expect(ledger.total()).toBeGreaterThan(0);for(const item of pending.slice(1))item.resolve({width:2,height:2,close});await expect(work).rejects.toThrow();await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(2));expect(ledger.total()).toBe(0);}finally{quiet.mockRestore();}
});
it('keeps the reservation if disposal of a scene resource throws',async()=>{
 const bytes=await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')),ledger=new AssetPeakBudget(64*1024*1024,()=>0),loaded=await loadWorkspaceFurnishingModel(three,renderer,descriptor(bytes),source(bytes),new AbortController().signal,()=>false,DEVICE_BUDGETS.desktop,ledger);let geometry:three.BufferGeometry|undefined;loaded.object.traverse(node=>{if(node instanceof three.Mesh)geometry=node.geometry;});vi.spyOn(geometry!,'dispose').mockImplementation(()=>{throw Error('LISTENER_FAILURE');});expect(()=>loaded.dispose()).toThrow('WORKSPACE_MODEL_DISPOSE_FAILED');expect(ledger.total()).toBeGreaterThan(0);
});
