// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {TransformControls,TransformControlsGizmo,TransformControlsPlane} from 'three/addons/controls/TransformControls.js';
import {expect,it} from 'vitest';
import {existingSceneCost,registerTransformControlsSceneCost} from './scene-cost';
import {OwnerPreviewBudget} from './owner-preview-budget';
function fixture(){
 const camera=new three.PerspectiveCamera();camera.position.set(3,4,5);camera.lookAt(0,0,0);
 const control=new TransformControls(camera),root=control.getHelper(),scene=new three.Scene(),target=new three.Object3D();scene.add(root,target);
 const gizmo=root.children.find((node):node is TransformControlsGizmo=>node instanceof TransformControlsGizmo)!,plane=root.children.find((node):node is TransformControlsPlane=>node instanceof TransformControlsPlane)!;
 return {camera,control,root,scene,target,gizmo,plane,planeMaterial:plane.material as three.Material,dispose(){const geometries=new Set<three.BufferGeometry>(),materials=new Set<three.Material>();root.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line){geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);}});for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();}};
}
function renderedCost(root:three.Object3D){let draws=0,triangles=0;root.traverseVisible(node=>{if(!(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points))return;if(!Array.isArray(node.material)&&!node.material.visible)return;const cost=existingSceneCost(three,node.clone(false));draws+=cost.draws;triangles+=cost.triangles;});return {draws,triangles};}
it('reserves the maximum complete control mode and independent triangle maximum, preserving the 256 cap',()=>{
 const f=fixture(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial();for(let i=0;i<154;i++)f.scene.add(new three.Mesh(geometry,material));
 let release=()=>{};try{
  expect(existingSceneCost(three,f.root)).toEqual({draws:68,triangles:3460});expect(existingSceneCost(three,f.scene).draws).toBe(222);
  const before=new OwnerPreviewBudget('synthetic',fetch,256-222,200000),hold=before.reserve(34,10068);expect(()=>before.reserve(49,100)).toThrow('WORKSPACE_SCENE_BUDGET');hold();
  release=registerTransformControlsSceneCost(three,f.control);
  expect(existingSceneCost(three,f.root)).toEqual({draws:19,triangles:1920});expect(existingSceneCost(three,f.scene).draws).toBe(173);
  // A descendant-only query cannot borrow a root charge outside its traversal.
  expect(existingSceneCost(three,f.gizmo.gizmo.translate)).toEqual({draws:13,triangles:224});
  const after=new OwnerPreviewBudget('synthetic',fetch,256-173,200000),a=after.reserve(34,10068),b=after.reserve(49,100);expect(after.remaining().remainingDraws).toBe(0);expect(()=>after.reserve(1,0)).toThrow('WORKSPACE_SCENE_BUDGET');a();b();
  release();release();expect(existingSceneCost(three,f.scene).draws).toBe(222);
 }finally{release();geometry.dispose();material.dispose();f.dispose();}
});
it('bounds all modes, handle axes and drag states without removing pickers or changing control behavior',()=>{
 const f=fixture(),release=registerTransformControlsSceneCost(three,f.control),nodes:three.Object3D[]=[];f.root.traverse(node=>nodes.push(node));f.control.attach(f.target);
 try{
  for(const mode of ['translate','rotate','scale'] as const)for(const dragging of [false,true])for(const axis of ['X','Y','Z','XYZ'] as const)for(const showX of [false,true]){
   f.control.setMode(mode);f.control.dragging=dragging;f.control.axis=axis;f.control.showX=showX;f.scene.updateMatrixWorld(true);
   const rendered=renderedCost(f.root),reserved=existingSceneCost(three,f.root);expect(reserved).toEqual({draws:19,triangles:1920});expect(rendered.draws).toBeLessThanOrEqual(reserved.draws);expect(rendered.triangles).toBeLessThanOrEqual(reserved.triangles);
   for(const key of ['translate','rotate','scale'] as const){expect(f.gizmo.picker[key].visible).toBe(false);expect(f.gizmo.gizmo[key].visible).toBe(key===mode);expect(f.gizmo.helper[key].visible).toBe(key===mode);}
  }
  const after:three.Object3D[]=[];f.root.traverse(node=>after.push(node));expect(after).toEqual(nodes);expect(f.planeMaterial.visible).toBe(false);expect(f.control.object).toBe(f.target);
 }finally{release();f.dispose();}
});
it('keeps ordinary hidden geometry conservative and ignores untrusted control-like metadata',()=>{
 const f=fixture(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),hidden=new three.Mesh(geometry,material);hidden.visible=false;hidden.userData.sceneSnapshotOverlay=true;hidden.userData.isTransformControlsRoot=true;f.scene.add(hidden);
 const release=registerTransformControlsSceneCost(three,f.control);try{expect(existingSceneCost(three,f.scene)).toEqual({draws:20,triangles:1932});}finally{release();geometry.dispose();material.dispose();f.dispose();}
});
it('falls back to full conservative cost if a picker or the hidden drag plane becomes renderable',()=>{
 const f=fixture(),release=registerTransformControlsSceneCost(three,f.control);try{
  f.gizmo.picker.translate.visible=true;expect(existingSceneCost(three,f.root)).toEqual({draws:68,triangles:3460});f.gizmo.picker.translate.visible=false;
  f.planeMaterial.visible=true;expect(existingSceneCost(three,f.root)).toEqual({draws:68,triangles:3460});f.planeMaterial.visible=false;expect(existingSceneCost(three,f.root).draws).toBe(19);
 }finally{release();f.dispose();}
});
it('counts additions and falls back after reparenting or changing registered geometry/material structure',()=>{
 const f=fixture(),release=registerTransformControlsSceneCost(three,f.control),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),extra=new three.Mesh(geometry,material);try{
  f.root.add(extra);expect(existingSceneCost(three,f.root).draws).toBe(20);extra.removeFromParent();
  const node=f.gizmo.gizmo.translate.children[0] as three.Mesh,original=node.material;node.material=Array.isArray(original)?original:[original];expect(existingSceneCost(three,f.root).draws).toBeGreaterThanOrEqual(68);node.material=original;
  const parent=node.parent!;f.scene.add(node);expect(existingSceneCost(three,f.scene).draws).toBe(68);parent.add(node);expect(existingSceneCost(three,f.root).draws).toBe(19);
 }finally{release();geometry.dispose();material.dispose();f.dispose();}
});
