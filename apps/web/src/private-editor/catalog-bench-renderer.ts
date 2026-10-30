// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {furnishingsFor,resolveFurnishing,validateFurnishings} from '@exhibitos/studio-contract';
import {geometryResidentBytes} from '../viewer/loading';
import {BENCH_CATALOG,BENCH_CATALOG_PATH,BENCH_RESERVE_BYTES} from './catalog-bench';

/** One verified private catalogue visual. The normal bench remains the collision/Sit host and fallback. */
export function privateCatalogBench(document:Exhibition){
 if(!validateFurnishings(document).valid)return undefined;const value=furnishingsFor(document);if(!value)return undefined;
 const rows=value.bindings.filter(b=>b.hostKind==='bench'&&value.assets.some(a=>a.id===b.assetId&&a.catalogId==='backless-oak-bench'));
 if(rows.length!==1)return undefined;const binding=rows[0]!,asset=value.assets.find(a=>a.id===binding.assetId)!;
 try{return {binding,resolved:resolveFurnishing(document,binding,asset)};}catch{return undefined;}
}
export function installPrivateCatalogBench(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,fallback:readonly Three.Group[],signal:AbortSignal,check:()=>Promise<void>,maxTriangles:number,changed:()=>void){
 const selected=privateCatalogBench(document);let disposed=false,model:Three.Object3D|undefined,hiddenHost:Three.Group|undefined;const resources=new Set<{dispose():void}>();
 const dispose=()=>{disposed=true;if(hiddenHost)hiddenHost.visible=true;model?.removeFromParent();for(const r of resources)r.dispose();resources.clear();};
 const start=async()=>{
  if(!selected)return 'unavailable';
  try{
   await check();signal.throwIfAborted();const r=await fetch('/'+BENCH_CATALOG_PATH,{credentials:'omit',redirect:'error',cache:'force-cache',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
   if(!r.ok||!r.body)throw Error('CATALOG_FETCH');const reader=r.body.getReader(),chunks:Uint8Array[]=[];let n=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>BENCH_CATALOG.bytes){await reader.cancel();throw Error('CATALOG_SIZE');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(n);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
   if(n!==BENCH_CATALOG.bytes||digest!==BENCH_CATALOG.sha256)throw Error('CATALOG_INTEGRITY');await check();signal.throwIfAborted();
   const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const manager=new three.LoadingManager();manager.setURLModifier(()=>{throw Error('CATALOG_EXTERNAL');});
   const gltf=await new GLTFLoader(manager).parseAsync(bytes.buffer,'');model=gltf.scene;let triangles=0,hasTexture=false;const attributes:Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>=[];
   model.traverse(node=>{if(node instanceof three.Mesh){resources.add(node.geometry);attributes.push(...Object.values(node.geometry.attributes) as Array<Three.BufferAttribute|Three.InterleavedBufferAttribute>);if(node.geometry.index)attributes.push(node.geometry.index);triangles+=(node.geometry.index?.count??node.geometry.attributes.position?.count??0)/3;for(const material of Array.isArray(node.material)?node.material:[node.material]){resources.add(material);if(Object.values(material).some(v=>v instanceof three.Texture))hasTexture=true;}}});
   if(hasTexture||disposed||signal.aborted||triangles>BENCH_CATALOG.triangles||triangles>maxTriangles||geometryResidentBytes(attributes)+n*4>BENCH_RESERVE_BYTES)throw Error('CATALOG_BUDGET');
   const {resolved,binding}=selected,room=rooms.get(resolved.roomId.toLowerCase()),host=fallback.find(g=>g.userData.benchId===binding.hostId);if(!room||!host)throw Error('CATALOG_HOST');
   const p=resolved.pose;model.position.fromArray(p.position);model.quaternion.fromArray(p.rotation);model.scale.fromArray(p.scale);room.add(model);hiddenHost=host;host.visible=false;changed();return 'ready';
  }catch{dispose();return 'fallback';}
 };
 return {start,dispose};
}
