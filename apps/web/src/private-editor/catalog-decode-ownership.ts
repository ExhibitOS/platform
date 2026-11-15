// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';

// This records logical ownership after a decoder has returned a model, not
// physical GC or GPU memory. Never retain the encoded buffer in the receipt.
const decoded=new WeakMap<Three.Object3D,{bytes:number;buffers:Set<ArrayBufferLike>}>();
function backing(three:typeof Three,model:Three.Object3D){
 const buffers=new Set<ArrayBufferLike>();let valid=true;
 const seen=new Set<object>();
 const plainMetadata=(value:unknown):boolean=>{
  if(value===null||typeof value!=='object')return true;
  if(seen.has(value)||value instanceof ArrayBuffer||ArrayBuffer.isView(value)||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  seen.add(value);const valid=Object.values(value).every(plainMetadata);seen.delete(value);return valid;
 };
 model.traverse(node=>{
  if(!plainMetadata(node.userData)||node.animations.length||'parser'in node)valid=false;
  if(!(node instanceof three.Mesh))return;
  const geometry=node.geometry;
  if(!plainMetadata(geometry.userData))valid=false;
  for(const attribute of [...Object.values(geometry.attributes),...(geometry.index?[geometry.index]:[])]){
   const array=('data'in attribute?attribute.data.array:attribute.array);
   if(!ArrayBuffer.isView(array))valid=false;else buffers.add(array.buffer);
  }
  for(const material of Array.isArray(node.material)?node.material:[node.material]){
   if(!plainMetadata(material.userData)||Object.values(material).some(value=>value instanceof three.Texture))valid=false;
  }
 });
 return valid&&buffers.size?buffers:undefined;
}

/** Call only after an opaque decode and authority recheck. The caller returns
 * model/resources only: no parser, input/chunks or closure owning those bytes.
 * CPU analysis may separately retain its input cache under its analysis guard. */
export function recordCatalogDecodeRetirement(three:typeof Three,model:Three.Object3D,encoded:Uint8Array){
 decoded.delete(model);
 const buffers=backing(three,model);
 if(buffers&&!buffers.has(encoded.buffer))decoded.set(model,{bytes:encoded.byteLength,buffers});
}

/** Strict named-profile owners may retire only a matching, unchanged receipt.
 * Synthetic templates, aliased input and changed backing keep the full charge. */
export function retiredCatalogDecodeBytes(three:typeof Three,model:Three.Object3D,bytes:number){
 const proof=decoded.get(model),buffers=proof&&backing(three,model);
 if(!proof||proof.bytes!==bytes||!buffers||buffers.size!==proof.buffers.size||[...buffers].some(buffer=>!proof.buffers.has(buffer)))return 0;
 return bytes*4;
}
