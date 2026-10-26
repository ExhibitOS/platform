// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {plaquesFor,validateStudioPlaques,PLAQUE_LIMITS} from '@exhibitos/studio-contract';
import {MemoryAssetCache} from './viewer/loading';
import {plaqueContent} from './plaque-content';
export function plaqueTextureReserve(document:Exhibition,compact:boolean){return Math.min(plaquesFor(document).filter(p=>p.visible).length,compact?PLAQUE_LIMITS.compact:PLAQUE_LIMITS.desktop)*PLAQUE_LIMITS.width*PLAQUE_LIMITS.height*4*2;}
/** One pooled plane and far material; bounded Canvas/texture/material LRU. No additional renderer or animation loop. */
export function installPlaques(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,compact:boolean,makeCanvas=()=>globalThis.document.createElement('canvas')){
 if(!validateStudioPlaques(document).valid)throw Error('PLAQUE_INVALID');
 const rows=plaquesFor(document).filter(p=>p.visible),cap=compact?PLAQUE_LIMITS.compact:PLAQUE_LIMITS.desktop,bytes=PLAQUE_LIMITS.width*PLAQUE_LIMITS.height*4;
 const geometry=rows.length?new three.PlaneGeometry(1,1):undefined,far=rows.length?new three.MeshBasicMaterial({color:0xf4f1e8,toneMapped:false}):undefined;
 type Entry={canvas:HTMLCanvasElement;texture:Three.CanvasTexture;material:Three.MeshBasicMaterial};
 const cache=new MemoryAssetCache<Entry>(cap*bytes,entry=>{entry.material.dispose();entry.texture.dispose();entry.canvas.width=0;entry.canvas.height=0;});
 const meshes:Three.Mesh<Three.PlaneGeometry,Three.MeshBasicMaterial>[]=[],failed=new Set<string>();let disposed=false;
 const touched=new Map<string,number>();let clock=0;
 const active=new Set<string>(),point=new three.Vector3(),forward=new three.Vector3(),cameraPoint=new three.Vector3(),projection=new three.Vector3(),normalMatrix=new three.Matrix3();
 const detach=()=>{for(const mesh of meshes)mesh.material=far!;for(const id of active)cache.release(id);active.clear();};
 try{for(const p of rows){const room=rooms.get(p.roomId.toLowerCase());if(!room)throw Error('PLAQUE_REFERENCE');const mesh=new three.Mesh(geometry!,far!);mesh.position.fromArray(p.position);mesh.quaternion.fromArray(p.rotation);mesh.scale.set(p.dimensions.width,p.dimensions.height,1);mesh.userData.plaqueId=p.id;mesh.userData.exhibitosPlaque=true;meshes.push(mesh);room.add(mesh);}}
 catch(error){for(const mesh of meshes)mesh.removeFromParent();geometry?.dispose();far?.dispose();throw error;}
 const create=(index:number):Entry=>{
  const canvas=makeCanvas();let texture:Three.CanvasTexture|undefined,material:Three.MeshBasicMaterial|undefined;
  try{canvas.width=PLAQUE_LIMITS.width;canvas.height=PLAQUE_LIMITS.height;const c=canvas.getContext('2d');if(!c)throw Error('PLAQUE_CANVAS_UNAVAILABLE');
   c.fillStyle='#f4f1e8';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#17352c';
   // Bounded glyph work. Full source remains available in the DOM request panel.
   const content=plaqueContent(document,rows[index]!);const fit=(text:string,max:number)=>{let value=Array.from(text).slice(0,max).join('');while(value&&c.measureText(value+'…').width>456)value=Array.from(value).slice(0,-1).join('');return value!==text?value+'…':value;};
   c.font='600 32px system-ui, sans-serif';c.fillText(fit(content.title,128),28,64);
   c.font='24px system-ui, sans-serif';c.fillText(fit(content.summary.split('\n')[0]??'',160),28,118);
   c.font='22px system-ui, sans-serif';c.fillText('선택하여 안내 읽기',28,212);
   texture=new three.CanvasTexture(canvas);texture.colorSpace=three.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=three.LinearFilter;texture.magFilter=three.LinearFilter;
   material=new three.MeshBasicMaterial({map:texture,toneMapped:false});return {canvas,texture,material};
  }catch(error){material?.dispose();texture?.dispose();canvas.width=0;canvas.height=0;throw error;}
 };
 return {meshes,update(camera:Three.Camera){
  if(disposed)return;camera.getWorldPosition(cameraPoint);const previous=new Set(active);detach();
  const candidates=meshes.map((mesh,index)=>{mesh.updateWorldMatrix(true,false);mesh.getWorldPosition(point);const distance=point.distanceTo(cameraPoint);forward.set(0,0,1).applyNormalMatrix(normalMatrix.getNormalMatrix(mesh.matrixWorld));const front=forward.dot(new three.Vector3().subVectors(cameraPoint,point))>0;projection.copy(point).project(camera);return {index,distance,eligible:front&&distance<=(previous.has(rows[index]!.id)?5:4)&&Math.abs(projection.x)<=1.2&&Math.abs(projection.y)<=1.2&&projection.z>=-1&&projection.z<=1};}).filter(v=>v.eligible).sort((a,b)=>a.distance-b.distance||a.index-b.index).slice(0,cap);
  for(const {index} of candidates){const id=rows[index]!.id;if(failed.has(id))continue;let entry=cache.get(id);if(!entry){try{if(cache.stats().entries>=cap){const oldest=[...touched].filter(([key])=>!active.has(key)).sort((a,b)=>a[1]-b[1])[0];if(oldest){cache.delete(oldest[0]);touched.delete(oldest[0]);}}entry=create(index);if(!cache.set(id,entry,bytes))continue;}catch{failed.add(id);continue;}}entry=cache.acquire(id);if(entry){touched.set(id,clock++);active.add(id);meshes[index]!.material=entry.material;}}
 },stats(){return {...cache.stats(),active:[...active],failed:[...failed],visible:meshes.length,reserveBytes:plaqueTextureReserve(document,compact),cpuCanvasBytes:cache.stats().entries*bytes};},dispose(){if(disposed)return;disposed=true;detach();for(const mesh of meshes)mesh.removeFromParent();cache.clear();geometry?.dispose();far?.dispose();failed.clear();touched.clear();}};
}
