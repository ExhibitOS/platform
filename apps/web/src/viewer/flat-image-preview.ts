// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {DetailView} from './detail-gesture';
import {flatImageView,imageFit,type ImageViewport} from './flat-image-view';
/** Borrow an admitted texture only. The flat quad owns no image/decoder allocation. */
export function flatImagePreview(three:typeof Three,object:Three.Object3D){
 const textureFor=(source:Three.Object3D)=>{
  let texture:Three.Texture|undefined;
  source.traverse(node=>{if(node instanceof three.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material]){
   const map=(material as Three.MeshBasicMaterial).map;if(map&&!texture)texture=map;
  }});
  const image=texture?.image as {width?:number;height?:number}|undefined;
  if(!texture||!image?.width||!image.height)throw Error('DETAIL_IMAGE_UNAVAILABLE');
  return {texture,width:image.width,height:image.height};
 };
 let image=textureFor(object);
 const scene=new three.Scene();scene.background=new three.Color('#181a20');
 const geometry=new three.PlaneGeometry(1,1),material=new three.MeshBasicMaterial({map:image.texture,toneMapped:false});
 const quad=new three.Mesh(geometry,material);scene.add(quad);
 const camera=new three.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;
 const render=(renderer:Three.WebGLRenderer,width:number,height:number,view:DetailView)=>{
  const viewport:ImageViewport={width,height,imageWidth:image.width,imageHeight:image.height,pixelRatio:renderer.getPixelRatio()};
  const bounded=flatImageView(view,viewport),fit=imageFit(viewport);
  camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();
  quad.scale.set(fit.width*bounded.zoom,fit.height*bounded.zoom,1);quad.position.set(bounded.panX??0,-(bounded.panY??0),0);
  renderer.render(scene,camera);return {viewport,view:bounded,maxZoom:fit.maxZoom};
 };
 return {render,replace(source:Three.Object3D){const previous=image;image=textureFor(source);material.map=image.texture;material.needsUpdate=true;return ()=>{image=previous;material.map=image.texture;material.needsUpdate=true;};},dispose(){geometry.dispose();material.dispose();scene.clear();}};
}
