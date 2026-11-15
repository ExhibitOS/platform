// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {expect,it} from 'vitest';
import {existingSceneCost} from './owner-scene';
import {OwnerPreviewBudget} from './owner-preview-budget';

it('counts an instanced batch once per rendering pass while retaining every instance triangle',()=>{
 const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial({side:three.DoubleSide});
 const mesh=new three.InstancedMesh(geometry,material,18);scene.add(mesh);
 try{
  expect(existingSceneCost(three,scene)).toEqual({draws:1,triangles:216});
  mesh.visible=false;expect(existingSceneCost(three,scene)).toEqual({draws:1,triangles:216});
  material.transparent=true;expect(existingSceneCost(three,scene)).toEqual({draws:2,triangles:432});
  material.forceSinglePass=true;expect(existingSceneCost(three,scene)).toEqual({draws:1,triangles:216});
  material.forceSinglePass=false;material.transparent=false;expect(existingSceneCost(three,scene,true)).toEqual({draws:2,triangles:432});
  expect(mesh.count).toBe(18);expect(mesh.visible).toBe(false);expect(mesh.geometry).toBe(geometry);expect(mesh.material).toBe(material);
 }finally{mesh.dispose();geometry.dispose();material.dispose();}
});
it('keeps zero-instance draws empty and refuses invalid counts',()=>{
 const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),mesh=new three.InstancedMesh(geometry,material,2);scene.add(mesh);
 try{
  mesh.count=0;expect(existingSceneCost(three,scene)).toEqual({draws:0,triangles:0});
  for(const count of [-1,NaN,Infinity,1.5]){mesh.count=count;expect(()=>existingSceneCost(three,scene)).toThrow('WORKSPACE_SCENE_BUDGET');}
 }finally{mesh.dispose();geometry.dispose();material.dispose();}
});
it('preserves conservative material-group and hidden ordinary-object charges',()=>{
 const scene=new three.Scene(),geometry=new three.BoxGeometry(),opaque=new three.MeshBasicMaterial(),transparent=new three.MeshBasicMaterial({transparent:true,side:three.DoubleSide});
 geometry.clearGroups();geometry.addGroup(0,18,0);geometry.addGroup(18,18,1);
 const batch=new three.InstancedMesh(geometry,[opaque,transparent],3),hidden=new three.Mesh(geometry,opaque);hidden.visible=false;scene.add(batch,hidden);
 try{expect(existingSceneCost(three,scene)).toEqual({draws:7,triangles:228});}
 finally{batch.dispose();geometry.dispose();opaque.dispose();transparent.dispose();}
});
it('admits a nine-draw furnishing under the unchanged 256 cap without lowering triangle work',()=>{
 const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),batch=new three.InstancedMesh(geometry,material,18);
 for(let i=0;i<233;i++)scene.add(new three.Mesh(geometry,material));scene.add(batch);
 try{
  // Former accounting charged 233 + 18 = 251, leaving only five for nine.
  const prior=new OwnerPreviewBudget('synthetic',fetch,256-251,175836);
  expect(()=>prior.reserve(9,1692)).toThrow('WORKSPACE_SCENE_BUDGET');
  const cost=existingSceneCost(three,scene);expect(cost).toEqual({draws:234,triangles:3012});
  const budget=new OwnerPreviewBudget('synthetic',fetch,256-cost.draws,175836),release=budget.reserve(9,1692);
  expect(budget.remaining()).toEqual({remainingDraws:13,remainingTriangles:174144});release();
  expect(budget.remaining()).toEqual({remainingDraws:22,remainingTriangles:175836});
 }finally{batch.dispose();geometry.dispose();material.dispose();}
});

it('reports diagnostic renderer classes without changing conservative scene cost or visibility',()=>{
 const scene=new three.Scene(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial(),mesh=new three.Mesh(geometry,material),batch=new three.InstancedMesh(geometry,material,3),line=new three.LineSegments(geometry,new three.LineBasicMaterial()),points=new three.Points(geometry,new three.PointsMaterial());
 mesh.visible=false;line.userData.sceneSnapshotOverlay=true;scene.add(mesh,batch,line,points);
 const inventory={meshDraws:0,instancedMeshDraws:0,lineDraws:0,pointsDraws:0,overlayDraws:0,directHiddenDraws:0,multiMaterialDraws:0};
 try{
  const prior=existingSceneCost(three,scene);expect(existingSceneCost(three,scene,false,inventory)).toEqual(prior);
  expect(inventory).toEqual({meshDraws:1,instancedMeshDraws:1,lineDraws:1,pointsDraws:1,overlayDraws:1,directHiddenDraws:1,multiMaterialDraws:0});
  expect(prior).toEqual({draws:4,triangles:48});expect(mesh.visible).toBe(false);expect(batch.count).toBe(3);
 }finally{batch.dispose();geometry.dispose();material.dispose();line.material.dispose();points.material.dispose();}
});
