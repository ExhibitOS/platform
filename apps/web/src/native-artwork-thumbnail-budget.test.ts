// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {assertThumbnailModelBudget} from './native-artwork-thumbnail';

function model(textureCount=3,edge=2048,triangles=100000){
 const geometry=new three.BufferGeometry();
 geometry.setAttribute('position',new three.BufferAttribute(new Float32Array(86202*3),3));
 geometry.setAttribute('normal',new three.BufferAttribute(new Float32Array(86202*3),3));
 geometry.setAttribute('uv',new three.BufferAttribute(new Float32Array(86202*2),2));
 geometry.setIndex(new three.BufferAttribute(new Uint32Array(triangles*3),1));
 const textures=Array.from({length:textureCount},()=>new three.Texture({width:edge,height:edge}));
 const materials=textures.map(map=>new three.MeshStandardMaterial({map}));
 const object=new three.Mesh(geometry,materials);
 return {object,textures,geometry,dispose(){geometry.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();}};
}

it('admits the measured 100k geometry and three 2048 maps without modifying resources',()=>{
 const m=model(),positions=m.geometry.getAttribute('position').array;
 try{
  // The retained model has 3,958,464 geometry bytes and 67,108,864 texture
  // bytes with mipmaps: 71,067,328 estimated resident bytes, not a peak claim.
  expect(()=>assertThumbnailModelBudget(three,m.object)).not.toThrow();
  expect(m.geometry.getAttribute('position').array).toBe(positions);
  expect(m.object.material.map(x=>x.map)).toEqual(m.textures);
  expect(()=>assertThumbnailModelBudget(three,m.object,{maxTextureSize:1024,maxCacheBytes:32*1024*1024})).toThrow('THUMBNAIL_TEXTURE_LIMIT');
 }finally{m.dispose();}
});

it('still refuses excessive decoded residency, dimensions and triangle counts',()=>{
 for(const [count,edge,triangles,error] of [[6,2048,100000,'THUMBNAIL_MODEL_LIMIT'],[1,4096,100000,'THUMBNAIL_TEXTURE_LIMIT'],[1,512,150001,'THUMBNAIL_MODEL_LIMIT']] as const){
  const m=model(count,edge,triangles);
  try{expect(()=>assertThumbnailModelBudget(three,m.object)).toThrow(error);}finally{m.dispose();}
 }
 for(const edge of [0,NaN,Infinity]){
  const m=model(1,edge);
  try{expect(()=>assertThumbnailModelBudget(three,m.object)).toThrow('THUMBNAIL_TEXTURE_LIMIT');}finally{m.dispose();}
 }
});

it('counts shared texture identities once while retaining the resident ceiling',()=>{
 const m=model(1);
 try{
  m.object.material=Array.from({length:8},()=>m.object.material[0]!);
  expect(()=>assertThumbnailModelBudget(three,m.object)).not.toThrow();
 }finally{m.dispose();}
});
