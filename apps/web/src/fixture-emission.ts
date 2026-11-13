// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';

/** Visual response only: stored linear RGB and the live light are authoritative.
 * I/(1+I) is bounded and monotonic; it does not modify illumination or photometry.
 * The caller owns this material exclusively, including its disposal. */
export function coupleFixtureEmission(mesh:Three.Mesh,material:Three.MeshStandardMaterial,light:Three.Light){
 const original=mesh.onBeforeRender,color=material.emissive.clone(),intensity=material.emissiveIntensity;let disposed=false;
 const update=()=>{
  const value=light.visible&&Number.isFinite(light.intensity)?Math.max(0,light.intensity):0;
  if(value>0){material.emissive.copy(light.color);material.emissiveIntensity=value/(1+value);}
  else{material.emissive.copy(color);material.emissiveIntensity=intensity;}
 };
 const render:Three.Mesh['onBeforeRender']=function(this:Three.Mesh,...args){original.apply(this,args);update();};
 mesh.onBeforeRender=render;update();
 return ()=>{if(disposed)return;disposed=true;if(mesh.onBeforeRender===render)mesh.onBeforeRender=original;material.emissive.copy(color);material.emissiveIntensity=intensity;};
}
