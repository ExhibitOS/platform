// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {WorkspaceFurnishingModel} from '@exhibitos/studio-contract';
import {basisLoader} from '../basis-loader';
import {embeddedPNGManager} from '../embedded-glb';
import {AssetPeakBudget,geometryResidentBytes,textureResidentBytes,workspaceFurnishingModelPreflight,type DeviceBudget} from '../viewer/loading';

/** This adapter is supplied by the trusted owner/publication integration, not
 * by a scene document. It must check the current registered descriptor and
 * display grant, and open only the corresponding scoped model. */
export interface WorkspaceModelSource {check():Promise<void>;open(signal:AbortSignal):Promise<Response>}

/** Load one already registered model under a caller-owned shared peak ledger.
 * This does not issue authority or attach anything to a scene. The caller must
 * recheck current permission while visible and dispose on revocation. After
 * disposal callers must drop their object reference; disposing does not detach
 * the caller's own references or synchronously reclaim browser/GPU memory. */
export async function loadWorkspaceFurnishingModel(three:typeof Three,renderer:Three.WebGLRenderer,model:WorkspaceFurnishingModel,source:WorkspaceModelSource,signal:AbortSignal,unavailable:()=>boolean,budget:DeviceBudget,ledger:AssetPeakBudget){
 if(!model||model.mime!=='model/gltf-binary'||!Number.isSafeInteger(model.bytes)||model.bytes<28||model.bytes>32*1024*1024||typeof model.sha256!=='string'||!/^[a-f0-9]{64}$/.test(model.sha256)||!source||typeof source.check!=='function'||typeof source.open!=='function')throw Error('WORKSPACE_MODEL_INVALID');
 const key=`workspace-model:${crypto.randomUUID()}`,resources=new Set<{dispose():void}>();let object:Three.Object3D|undefined,scope:ReturnType<typeof embeddedPNGManager>|undefined,basis:Awaited<ReturnType<typeof basisLoader>>,disposed=false,reserved=false,parseStarted=false,parseComplete=false;
 const active=()=>{signal.throwIfAborted();if(disposed||unavailable())throw Error('WORKSPACE_MODEL_INACTIVE');};
 const dispose=()=>{if(disposed)return;disposed=true;let failed=false;const attempt=(action:()=>void)=>{try{action();}catch{failed=true;}};attempt(()=>object?.traverse(node=>{if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material]){resources.add(material);for(const value of Object.values(material))if(value instanceof three.Texture&&!scope?.ownsTexture(value))resources.add(value);}}));attempt(()=>object?.removeFromParent());for(const resource of resources)attempt(()=>resource.dispose());resources.clear();if(scope){attempt(()=>scope!.dispose());if(!scope.cleanupOK())failed=true;attempt(()=>scope!.retire());}if(basis)attempt(()=>basis!.dispose());object=undefined;scope=undefined;basis=undefined;if(reserved&&!failed&&(!parseStarted||parseComplete)){ledger.release(key);reserved=false;}if(failed)throw Error('WORKSPACE_MODEL_DISPOSE_FAILED');};
 try{
  ledger.reserve(key,model.bytes*4);reserved=true;await source.check();active();
  const fetchSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]),response=await source.open(fetchSignal);try{fetchSignal.throwIfAborted();active();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='model/gltf-binary'){await response.body?.cancel().catch(()=>{});throw Error('WORKSPACE_MODEL_FETCH');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  const cancelRead=()=>{void reader.cancel().catch(()=>{});};fetchSignal.addEventListener('abort',cancelRead,{once:true});
  try{for(;;){const {done,value}=await reader.read();fetchSignal.throwIfAborted();active();if(done)break;length+=value.length;if(length>model.bytes)throw Error('WORKSPACE_MODEL_INTEGRITY');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{fetchSignal.removeEventListener('abort',cancelRead);reader.releaseLock();}
  if(length!==model.bytes)throw Error('WORKSPACE_MODEL_INTEGRITY');const encoded=new Uint8Array(length);let offset=0;for(const chunk of chunks){encoded.set(chunk,offset);offset+=chunk.length;}
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))].map(v=>v.toString(16).padStart(2,'0')).join('');active();if(digest!==model.sha256)throw Error('WORKSPACE_MODEL_INTEGRITY');
  const plan=workspaceFurnishingModelPreflight(encoded.buffer,model.bytes,budget);ledger.reserve(key,plan.reserveBytes);await source.check();active();
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');basis=await basisLoader(renderer,encoded.buffer);active();const manager=new three.LoadingManager();scope=embeddedPNGManager(manager,encoded.buffer,basis);const currentScope=scope;
  const loader=new GLTFLoader(manager);if(scope.ktx2Loader)loader.setKTX2Loader(scope.ktx2Loader as never);
  parseStarted=true;const parsing=loader.parseAsync(scope.bytes,'').then(async result=>{await currentScope.drain();return result;});
  const cancelDecode=()=>currentScope.dispose();signal.addEventListener('abort',cancelDecode,{once:true});
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(30000)]);let cancelDeadline:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{const abort=()=>reject(deadline.reason);cancelDeadline=()=>deadline.removeEventListener('abort',abort);if(deadline.aborted)abort();else deadline.addEventListener('abort',abort,{once:true});});
  let result;try{result=await Promise.race([parsing,interrupted]);parseComplete=true;}
  catch(error){
   // A rejected Three parser does not prove that its sibling dependency jobs
   // have stopped. Keep this reservation quarantined if it cannot complete.
   currentScope.dispose();void parsing.then(late=>{object=late.scene;parseComplete=true;try{dispose();}catch{/* Keep the reservation on cleanup failure. */}},()=>{try{currentScope.retire();basis?.dispose();}catch{/* The failed parse stays quarantined. */}});
   throw error;
  }finally{signal.removeEventListener('abort',cancelDecode);cancelDeadline();}
  currentScope.retire();object=result.scene;const attributes:Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>=[],textures=new Set<Three.Texture>();let draws=0,triangles=0;
  object.traverse(node=>{if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;resources.add(node.geometry);attributes.push(...Object.values(node.geometry.attributes) as Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>);if(node.geometry.index)attributes.push(node.geometry.index);const materials=Array.isArray(node.material)?node.material:[node.material];if(materials.length!==1)throw Error('WORKSPACE_MODEL_UNSUPPORTED');const material=materials[0]!;resources.add(material);const passes=material.transparent&&material.side===three.DoubleSide&&!material.forceSinglePass?2:1;draws+=passes;if(node instanceof three.Mesh)triangles+=(node.geometry.index?.count??node.geometry.attributes.position?.count??0)/3*passes;for(const value of Object.values(material))if(value instanceof three.Texture)textures.add(value);});
  currentScope.assertLoaded();let actual=geometryResidentBytes(attributes)+model.bytes*4;for(const texture of textures){if(!currentScope.ownsTexture(texture))resources.add(texture);const image=texture.image as {width?:number;height?:number}|undefined,w=image?.width,h=image?.height;if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||!w||!h||w>budget.maxTextureSize||h>budget.maxTextureSize)throw Error('WORKSPACE_MODEL_BUDGET');actual+=textureResidentBytes(w,h);}
  if(!Number.isSafeInteger(triangles)||triangles>plan.triangles||draws>plan.draws||!Number.isSafeInteger(actual))throw Error('WORKSPACE_MODEL_BUDGET');ledger.reserve(key,Math.max(plan.reserveBytes,actual));await source.check();active();
  return {object,triangles,draws,reserveBytes:Math.max(plan.reserveBytes,actual),dispose};
 }catch(error){if(!parseStarted||parseComplete){try{dispose();}catch{/* A failed cleanup keeps its reservation. */}}throw error;}
}
