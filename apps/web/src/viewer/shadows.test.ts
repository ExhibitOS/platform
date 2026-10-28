// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as three from 'three';
import {installBoundedShadows,directionalNormalBias,SHADOW_RESERVE_BYTES,type ShadowReport} from './shadows';

function setup(compact=false,bytes=SHADOW_RESERVE_BYTES) {
  const room=new three.Group(),mesh=new three.Mesh<three.BufferGeometry,three.MeshStandardMaterial>(new three.BoxGeometry(1,1,1),new three.MeshStandardMaterial());room.add(mesh);
  const light=new three.DirectionalLight();light.position.set(4,8,4);room.add(light,light.target);
  const renderer={shadowMap:{enabled:false,autoUpdate:true,type:three.BasicShadowMap,needsUpdate:false}} as unknown as three.WebGLRenderer;
  const reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,renderer,[{room,light}],compact,bytes,value=>reports.push(value));
  return {room,mesh,light,renderer,reports,pass};
}
test('compact and insufficient reserve allocate no shadow and retain material meaning',()=>{
  for(const [compact,bytes,mode]of [[true,SHADOW_RESERVE_BYTES,'compact'],[false,SHADOW_RESERVE_BYTES-1,'budget']] as const){
    const h=setup(compact,bytes),material=h.mesh.material;h.pass.flush();
    expect(h.reports[0]?.mode).toBe(mode);expect(h.light.shadow.map).toBeNull();expect(h.light.castShadow).toBe(false);expect(h.mesh.material).toBe(material);expect(h.renderer.shadowMap.enabled).toBe(false);h.pass.dispose();
  }
});
test('light fixture bodies do not consume or cast the existing bounded shadow pass',()=>{
  const h=setup(),fixture=new three.Mesh(new three.BoxGeometry(.1,.1,.2),new three.MeshStandardMaterial());fixture.userData.exhibitosLightFixture=true;h.room.add(fixture);h.pass.flush();expect(h.reports.at(-1)?.casters).toBe(1);expect(fixture.castShadow).toBe(false);expect(fixture.receiveShadow).toBe(false);h.pass.dispose();fixture.geometry.dispose();(fixture.material as three.Material).dispose();
});
test('PCF receiver bias follows fitted world footprint without changing map budget or caster policy',()=>{
  const h=setup();h.mesh.geometry=new three.PlaneGeometry(8,8);h.mesh.rotation.x=-Math.PI/2;h.mesh.material.side=three.DoubleSide;
  const material=h.mesh.material,geometry=h.mesh.geometry,authored=h.light.position.clone();h.pass.flush();
  const initial=h.light.shadow.normalBias;expect(initial).toBeGreaterThan(.01);
  expect(h.mesh.castShadow&&h.mesh.receiveShadow).toBe(true);expect(h.light.shadow.mapSize.toArray()).toEqual([512,512]);expect(SHADOW_RESERVE_BYTES).toBe(2097152);
  expect(h.mesh.geometry).toBe(geometry);expect(h.mesh.material).toBe(material);expect(h.light.position.equals(authored)).toBe(true);
  h.mesh.scale.setScalar(.5);h.pass.invalidate();h.pass.flush();expect(h.light.shadow.normalBias).toBeLessThan(initial);expect(h.light.shadow.normalBias).toBeGreaterThanOrEqual(.01);
  h.pass.dispose();
});
test('PCF footprint accounts for both orthographic axes and retains existing small-scene floor',()=>{
  expect(directionalNormalBias(.5,.5,1)).toBe(.01);
  expect(directionalNormalBias(8,4,1)).toBe(directionalNormalBias(4,8,1));
  expect(directionalNormalBias(16,8,1)).toBeCloseTo(2*directionalNormalBias(8,4,1));
  expect(directionalNormalBias(8,4,2)).toBeGreaterThan(directionalNormalBias(8,4,1));
});
function shadowArgs(h:ReturnType<typeof setup>,depth:three.Material):Parameters<three.Mesh['onBeforeShadow']>{
  return [h.renderer,new three.Scene(),new three.Camera(),h.light.shadow.camera,h.mesh.geometry,depth,new three.Group()];
}
test('planar depth side follows rotated surface without mutating shared authored material or solid caster',()=>{
  const h=setup();h.mesh.geometry=new three.PlaneGeometry(1,1).rotateX(.47).rotateY(.63);
  const material=h.mesh.material,solid=new three.Mesh(new three.BoxGeometry(1,1,1),material);h.room.add(solid);
  const before=h.mesh.onBeforeShadow,after=h.mesh.onAfterShadow;h.pass.flush();
  expect(h.mesh.onBeforeShadow).not.toBe(before);expect(solid.onBeforeShadow).toBe(before);
  const depth=new three.MeshDepthMaterial({side:three.BackSide}),args=shadowArgs(h,depth);
  h.mesh.onBeforeShadow(...args);expect(depth.side).toBe(three.FrontSide);
  expect(material.side).toBe(three.FrontSide);expect(material.shadowSide).toBeNull();expect(h.mesh.material).toBe(material);expect(solid.material).toBe(material);
  h.mesh.onAfterShadow(...args);expect(depth.side).toBe(three.BackSide);
  material.shadowSide=three.BackSide;h.mesh.onBeforeShadow(...args);expect(depth.side).toBe(three.BackSide);
  h.pass.dispose();expect(h.mesh.onBeforeShadow).toBe(before);expect(h.mesh.onAfterShadow).toBe(after);expect(material.shadowSide).toBe(three.BackSide);
});
test('planar depth policy preserves explicit and custom deformation or shadow intent',()=>{
  const cases:((h:ReturnType<typeof setup>)=>void)[]=[
    h=>{h.mesh.material.shadowSide=three.BackSide;},
    h=>{h.mesh.customDepthMaterial=new three.MeshDepthMaterial();},
    h=>{h.mesh.material.onBeforeCompile=()=>{};},
    h=>{h.mesh.onBeforeShadow=()=>{};},
    h=>{h.mesh.material.displacementMap=new three.Texture();},
    h=>{h.mesh.geometry.morphAttributes.position=[h.mesh.geometry.getAttribute('position').clone()];},
    h=>{h.mesh.geometry=new three.BoxGeometry(1,1,1);},
    h=>{h.mesh.geometry=new three.BoxGeometry(1/512,1,1).translate(10000,0,0);h.mesh.position.x=-10000;},
    h=>{const p=h.mesh.geometry.getAttribute('position');p.setZ(0,.02);},
    h=>{h.mesh.geometry=new three.BufferGeometry().setFromPoints([new three.Vector3(),new three.Vector3(1,0,0),new three.Vector3(2,0,0)]);},
  ];
  for(const configure of cases){const h=setup();h.mesh.geometry=new three.PlaneGeometry(1,1);configure(h);const before=h.mesh.onBeforeShadow,after=h.mesh.onAfterShadow;h.pass.flush();expect(h.mesh.onBeforeShadow).toBe(before);expect(h.mesh.onAfterShadow).toBe(after);h.pass.dispose();}
  const geometry=new three.PlaneGeometry(1,1),material=new three.MeshStandardMaterial();
  const skinned=new three.SkinnedMesh(geometry,material);skinned.boundingBox=new three.Box3(new three.Vector3(-.5,-.5,0),new three.Vector3(.5,.5,0));
  const instanced=new three.InstancedMesh(geometry,material,1);instanced.setMatrixAt(0,new three.Matrix4());
  for(const mesh of [skinned,instanced,new three.Mesh(geometry,[material]),new three.Mesh(geometry,new three.ShaderMaterial())]){
    const h=setup();h.room.remove(h.mesh);h.room.add(mesh);const before=mesh.onBeforeShadow,after=mesh.onAfterShadow;h.pass.flush();expect(mesh.onBeforeShadow).toBe(before);expect(mesh.onAfterShadow).toBe(after);h.pass.dispose();
  }
});
test('planar depth side and owned hooks restore after interrupted draw, exclusion and disposal',()=>{
  const h=setup();h.mesh.geometry=new three.PlaneGeometry(1,1);const before=h.mesh.onBeforeShadow,after=h.mesh.onAfterShadow;h.pass.flush();
  const depth=new three.MeshDepthMaterial({side:three.BackSide}),args=shadowArgs(h,depth);
  expect(()=>{try{h.mesh.onBeforeShadow(...args);throw Error('draw failed');}finally{h.pass.afterRender();}}).toThrow('draw failed');expect(depth.side).toBe(three.BackSide);
  h.mesh.onBeforeShadow(...args);h.mesh.visible=false;h.pass.invalidate();h.pass.flush();expect(depth.side).toBe(three.BackSide);expect(h.mesh.onBeforeShadow).toBe(before);expect(h.mesh.onAfterShadow).toBe(after);
  h.mesh.visible=true;h.pass.invalidate();h.pass.flush();h.mesh.onBeforeShadow(...args);const replacement=()=>{};h.mesh.onBeforeShadow=replacement;h.pass.dispose();h.pass.dispose();expect(depth.side).toBe(three.BackSide);expect(h.mesh.onBeforeShadow).toBe(replacement);expect(h.mesh.onAfterShadow).toBe(after);
});
test('only dirty scene changes update one bounded map; navigation and repeated renders reuse it',()=>{
  const h=setup();h.pass.flush();expect(h.reports[0]).toMatchObject({mode:'bounded',mapSize:512,casters:1,triangles:12,updates:1});
  expect(h.light.castShadow&&h.mesh.castShadow&&h.mesh.receiveShadow).toBe(true);expect(h.light.shadow.autoUpdate).toBe(false);expect(h.renderer.shadowMap.autoUpdate).toBe(false);
  h.light.shadow.needsUpdate=false;h.renderer.shadowMap.needsUpdate=false;h.pass.flush();h.pass.flush();
  expect(h.reports).toHaveLength(1);expect(h.light.shadow.needsUpdate||h.renderer.shadowMap.needsUpdate).toBe(false);
  h.mesh.position.x=1;h.pass.invalidate();h.pass.flush();expect(h.reports.at(-1)?.updates).toBe(2);expect(h.light.shadow.needsUpdate&&h.renderer.shadowMap.needsUpdate).toBe(true);
  h.pass.dispose();h.pass.dispose();expect(h.mesh.castShadow||h.mesh.receiveShadow).toBe(false);expect(h.renderer.shadowMap.enabled).toBe(false);expect(h.renderer.shadowMap.autoUpdate).toBe(true);
});
test('fit uses light-space distance, world bounds and finite depth instead of camera-relative range',()=>{
  const h=setup();h.room.position.set(10,0,5);h.room.rotation.y=.5;h.light.position.set(20,30,25);h.pass.flush();
  expect(h.reports.at(-1)?.mode).toBe('bounded');expect(h.light.shadow.camera.far).toBeGreaterThan(20);expect(h.light.shadow.camera.far).toBeLessThanOrEqual(128);
  const box=new three.Box3().setFromObject(h.room),view=h.light.shadow.camera;h.light.shadow.updateMatrices(h.light);
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new three.Vector3(x,y,z).project(view);expect(Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))).toBeLessThanOrEqual(1.00001);
  }
  h.room.scale.setScalar(30);h.pass.invalidate();h.pass.flush();expect(h.reports.at(-1)?.mode).toBe('unavailable');expect(h.renderer.shadowMap.enabled).toBe(false);h.pass.dispose();
});
test('primary switch releases old target before another map can be allocated; disposal is idempotent',()=>{
  const h=setup(),second=new three.SpotLight();second.position.set(2,6,3);h.room.add(second,second.target);h.pass.dispose();
  const pass=installBoundedShadows(three,h.renderer,[{light:h.light,room:h.room},{light:second,room:h.room}],false,SHADOW_RESERVE_BYTES,()=>{});pass.flush();
  const map=new three.WebGLRenderTarget(512,512);let freed=0;map.addEventListener('dispose',()=>freed++);h.light.shadow.map=map;
  h.light.intensity=0;pass.invalidate();pass.flush();expect(freed).toBe(1);expect(h.light.shadow.map).toBeNull();expect(second.castShadow).toBe(true);
  pass.dispose();pass.dispose();expect(freed).toBe(1);
});
test('a large room retains a bounded representative shadow region instead of omitting the exhibition',()=>{
  const h=setup();h.mesh.geometry=new three.BoxGeometry(60,.1,60);h.light.position.set(20,30,25);h.pass.flush();
  expect(h.reports.at(-1)).toMatchObject({mode:'bounded',casters:1});
  const camera=h.light.shadow.camera;
  expect(camera.right-camera.left).toBeLessThan(35);expect(camera.top-camera.bottom).toBeLessThan(35);
  expect(h.mesh.geometry.getAttribute('position').count).toBe(24);h.pass.dispose();
});
test('directional light inside the capture fits rear casters without moving authored illumination',()=>{
  const h=setup();h.mesh.geometry=new three.BoxGeometry(2,4,2);h.light.position.set(0,1,0);
  const authored=h.light.position.clone(),target=h.light.target,original=h.light.shadow.updateMatrices;
  h.pass.flush();expect(h.reports.at(-1)?.mode).toBe('bounded');h.light.shadow.updateMatrices(h.light);
  const box=new three.Box3().setFromObject(h.room);
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const point=new three.Vector3(x,y,z).project(h.light.shadow.camera);
    expect(Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))).toBeLessThanOrEqual(1.00001);
  }
  expect(h.light.position.equals(authored)).toBe(true);expect(h.light.target).toBe(target);
  expect(h.light.shadow.camera.near).toBeGreaterThan(0);h.pass.dispose();expect(h.light.shadow.updateMatrices).toBe(original);
});
test('one sun changing eligible room reuses its map and keeps the fitted directional depth pose',()=>{
  const h=setup(),other=new three.Group();other.position.x=5;other.add(new three.Mesh(new three.BoxGeometry(2,4,2),h.mesh.material));h.light.position.set(0,1,0);h.pass.dispose();
  const pass=installBoundedShadows(three,h.renderer,[{light:h.light,room:h.room},{light:h.light,room:other}],false,SHADOW_RESERVE_BYTES,()=>{});pass.flush();
  const map=new three.WebGLRenderTarget(512,512);let freed=0;map.addEventListener('dispose',()=>freed++);h.light.shadow.map=map;h.room.remove(h.mesh);
  pass.invalidate();pass.flush();expect(h.light.shadow.map).toBe(map);expect(freed).toBe(0);h.light.shadow.updateMatrices(h.light);
  const box=new three.Box3().setFromObject(other);
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const point=new three.Vector3(x,y,z).project(h.light.shadow.camera);expect(Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))).toBeLessThanOrEqual(1.00001);
  }
  pass.dispose();pass.dispose();expect(freed).toBe(1);
});
test('excess caster triangles and transparent shells omit shadows without dropping scene geometry',()=>{
  const h=setup();h.mesh.material.transparent=true;h.pass.flush();expect(h.reports.at(-1)?.casters).toBe(0);expect(h.mesh.castShadow).toBe(false);
  h.mesh.material.transparent=false;h.mesh.geometry.setIndex(new three.BufferAttribute(new Uint32Array(300003),1));h.pass.invalidate();h.pass.flush();
  expect(h.reports.at(-1)?.mode).toBe('unavailable');expect(h.room.children).toContain(h.mesh);expect(h.mesh.geometry.index?.count).toBe(300003);h.pass.dispose();
});
test('one oversized caster does not disable other bounded room shadows or change visible geometry',()=>{const h=setup(),mesh=new three.InstancedMesh(new three.BoxGeometry(1,1,1),h.mesh.material,9000),identity=new three.Matrix4();for(let i=0;i<9000;i++)mesh.setMatrixAt(i,identity);mesh.computeBoundingBox();mesh.computeBoundingSphere();h.room.add(mesh);h.pass.flush();expect(h.reports.at(-1)?.mode).toBe('bounded');expect(h.reports.at(-1)?.omittedCasters).toBe(1);expect(h.reports.at(-1)!.triangles).toBeLessThanOrEqual(100000);expect(mesh.castShadow).toBe(false);expect(mesh.receiveShadow).toBe(true);expect(h.mesh.castShadow).toBe(true);expect(h.room.children).toContain(mesh);expect(mesh.count).toBe(9000);h.pass.dispose();mesh.dispose();mesh.geometry.dispose();});
