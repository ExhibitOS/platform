// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {BoxGeometry,DoubleSide,Group,Mesh,MeshBasicMaterial,Raycaster,Vector3,type Intersection,type Object3D} from 'three';
import {detailPickHit,registerDetailPickDisplayCase} from './detail-picking';
import {furnishingCollisionMesh} from './furnishing-collision-mesh';
import * as three from 'three';

function scene(){
 const model=new Group(),displayCase=new Group(),art=new Group();
 const glass=new Mesh(new BoxGeometry(1,1,.02),new MeshBasicMaterial({transparent:true,opacity:.07,side:DoubleSide}));
 glass.position.z=1;displayCase.add(glass);model.add(displayCase);
 art.userData.placementId='artwork-placement';
 const work=new Mesh(new BoxGeometry(.5,.5,.2),new MeshBasicMaterial());art.add(work);model.add(art);
 model.updateMatrixWorld(true);
 const ray=new Raycaster(new Vector3(0,0,2),new Vector3(0,0,-1));
 return {model,displayCase,glass,art,work,ray,hits:()=>ray.intersectObject(model,true)};
}
function placement(hit:Intersection<Object3D>|undefined){for(let o=hit?.object;o;o=o.parent??undefined)if(o.userData.placementId)return o.userData.placementId;}
describe('detail picking through registered case glazing',()=>{
 it('reaches the existing artwork behind multiple case faces without changing geometry or collisions',()=>{
  const f=scene(),before=f.hits(),raycast=f.glass.raycast,material=f.glass.material,collisionBefore=furnishingCollisionMesh(three,f.displayCase);
  expect(before[0]?.object).toBe(f.glass);expect(placement(before[0])).toBeUndefined();
  registerDetailPickDisplayCase(f.displayCase);
  expect(placement(detailPickHit(before))).toBe('artwork-placement');
  expect(f.hits()).toEqual(before);expect(f.glass.raycast).toBe(raycast);expect(f.glass.material).toBe(material);expect(f.glass.visible).toBe(true);
  expect(collisionBefore?.indices.length).toBeGreaterThan(0);
  expect(furnishingCollisionMesh(three,f.displayCase)).toEqual(collisionBefore);
 });
 it('keeps opaque case parts and opaque walls in front of the work as blockers',()=>{
  const f=scene();registerDetailPickDisplayCase(f.displayCase);
  const post=new Mesh(new BoxGeometry(.1,.1,.02),new MeshBasicMaterial());post.position.z=.5;f.displayCase.add(post);f.model.updateMatrixWorld(true);
  expect(detailPickHit(f.hits())?.object).toBe(post);
  f.displayCase.remove(post);
  const wall=new Mesh(new BoxGeometry(2,2,.02),new MeshBasicMaterial());wall.position.z=.5;f.model.add(wall);f.model.updateMatrixWorld(true);
  expect(detailPickHit(f.hits())?.object).toBe(wall);
 });
 it('does not make unregistered transparent furnishings or model extras click-through',()=>{
  const f=scene();f.displayCase.userData.viewerDisplayCase=true;f.glass.userData.viewerDisplayCase=true;
  expect(detailPickHit(f.hits())?.object).toBe(f.glass);
 });
 it('preserves translucent artwork and plaque targets, including those below a registered root',()=>{
  const f=scene();registerDetailPickDisplayCase(f.displayCase);
  f.glass.userData.placementId='visible-work';expect(placement(detailPickHit(f.hits()))).toBe('visible-work');
  delete f.glass.userData.placementId;f.glass.userData.plaqueId='visible-plaque';expect(detailPickHit(f.hits())?.object).toBe(f.glass);
 });
 it('only skips actual translucent materials and respects the intersected material slot',()=>{
  const f=scene();registerDetailPickDisplayCase(f.displayCase);
  for(const change of [{transparent:false,opacity:.07},{transparent:true,opacity:1},{transparent:true,opacity:NaN}]){
   Object.assign(f.glass.material,change);expect(detailPickHit(f.hits())?.object).toBe(f.glass);
  }
  const glass=new MeshBasicMaterial({transparent:true,opacity:.07}),opaque=new MeshBasicMaterial();
  const hit={...f.hits()[0]!,face:{...f.hits()[0]!.face!,materialIndex:1}};
  f.glass.material=[glass,opaque] as unknown as MeshBasicMaterial;
  expect(detailPickHit([hit])?.object).toBe(f.glass);
  expect(detailPickHit([{...hit,face:{...hit.face,materialIndex:0}}])).toBeUndefined();
 });
 it('leaves an ordinary unencased work and empty rays unchanged',()=>{
  const f=scene();f.model.remove(f.displayCase);expect(placement(detailPickHit(f.hits()))).toBe('artwork-placement');expect(detailPickHit([])).toBeUndefined();
 });
});
