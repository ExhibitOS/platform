// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import * as three from 'three';
import {installBoundedShadows,installSupportContactShadows,leaseOptionalShadowMaps,shadowWorkingSetReady,directionalNormalBias,SHADOW_RESERVE_BYTES,SHADOW_TRIANGLE_LIMIT,type ShadowReport,type SupportContact} from './shadows';
import {AssetPeakBudget} from './loading';

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
test('an authored plaque receives only the existing room shadow and restores its flags',()=>{
  const plaque=new three.Mesh(new three.PlaneGeometry(.9,.37),new three.MeshStandardMaterial());
  plaque.userData.exhibitosPlaque=true;
  const h=setup();
  h.room.add(plaque);
  const before=plaque.onBeforeShadow,material=plaque.material;
  h.pass.flush();
  expect(h.reports.at(-1)).toMatchObject({mode:'bounded',mapSize:512,casters:1,triangles:12,omittedCasters:0});
  expect(plaque.receiveShadow).toBe(true);
  expect(plaque.castShadow).toBe(false);
  expect(plaque.onBeforeShadow).toBe(before);
  expect(plaque.material).toBe(material);
  h.pass.dispose();
  expect(plaque.receiveShadow).toBe(false);
  const compact=setup(true);
  compact.room.add(plaque);
  compact.pass.flush();
  expect(compact.reports.at(-1)).toMatchObject({mode:'compact',mapSize:0,casters:0});
  expect(plaque.receiveShadow).toBe(false);
  compact.pass.dispose();
  plaque.geometry.dispose();
  material.dispose();
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
  // This hook-policy fixture has no animated skeleton; provide its authored
  // static sphere so the real renderer culling predicate need not skin it.
  geometry.computeBoundingSphere();skinned.boundingSphere=geometry.boundingSphere!.clone();
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
test('an explicit authored spot owns the one map ahead of an automatic directional source',()=>{
  const h=setup();h.pass.dispose();
  const spot=new three.SpotLight();spot.position.set(0,4,0);spot.target.position.set(0,0,2);h.room.add(spot,spot.target);
  const sourceLightId=crypto.randomUUID(),reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light},{room:h.room,light:spot,authoredCastShadow:true,sourceLightId}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();expect(h.light.castShadow).toBe(false);expect(spot.castShadow).toBe(true);
  expect(reports.at(-1)).toMatchObject({mode:'bounded',sourceLightId,mapSize:512,updates:1});
  expect(spot.shadow.autoUpdate||h.renderer.shadowMap.autoUpdate).toBe(false);
  pass.flush();expect(reports).toHaveLength(1);pass.dispose();
});
test('an inactive explicit source does not silently substitute automatic room illumination',()=>{
  const h=setup();h.pass.dispose();
  const spot=new three.SpotLight();spot.position.set(0,4,0);h.room.add(spot,spot.target);
  const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light},{room:h.room,light:spot,authoredCastShadow:true}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();const map=new three.WebGLRenderTarget(512,512),dispose=vi.fn();map.addEventListener('dispose',dispose);spot.shadow.map=map;
  spot.intensity=0;pass.invalidate();pass.flush();
  expect(dispose).toHaveBeenCalledTimes(1);expect(reports.at(-1)?.mode).toBe('unavailable');
  expect(h.light.castShadow||spot.castShadow||h.renderer.shadowMap.enabled).toBe(false);pass.dispose();
});
test('authored target geometry and its support take bounded priority while transparent glass stays unchanged',()=>{
  const h=setup();h.pass.dispose();h.room.remove(h.mesh);
  const target=new three.Group(),targetPlacementId=crypto.randomUUID();target.userData.placementId=targetPlacementId;h.room.add(target);
  const sculpture=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial({color:0x998877}));
  sculpture.geometry.setIndex(new three.BufferAttribute(new Uint32Array(270000),1));
  const support=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial());support.position.y=-1;
  const glass=new three.Mesh(new three.BoxGeometry(2,3,2),new three.MeshStandardMaterial({transparent:true,opacity:.07,side:three.DoubleSide}));
  target.add(sculpture,support,glass);
  const architecture=new three.Mesh(new three.BoxGeometry(8,1,8),new three.MeshStandardMaterial());architecture.position.y=-2;architecture.geometry.setIndex(new three.BufferAttribute(new Uint32Array(600000),1));h.room.add(architecture);
  const spot=new three.SpotLight();spot.position.set(1,4,-2);h.room.add(spot,spot.target);
  const reports:ShadowReport[]=[],fixed=new three.Box3(new three.Vector3(-5,-3,-5),new three.Vector3(5,5,5));
  const material=sculpture.material,color=material.color.clone(),glassMaterial=glass.material,raycast=glass.raycast;
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:spot,authoredCastShadow:true,targetPlacementId}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r),fixed);
  const camera=contactView();pass.flush(camera);
  expect(reports.at(-1)).toMatchObject({mode:'bounded',targetPlacementId,targetCasters:2,targetTriangles:90012,omittedTargetCasters:0,omittedCasters:1});
  expect(sculpture.castShadow&&support.castShadow).toBe(true);expect(architecture.castShadow||glass.castShadow).toBe(false);
  expect(sculpture.material).toBe(material);expect(material.color).toEqual(color);expect(glass.material).toBe(glassMaterial);expect(glass.raycast).toBe(raycast);expect(glass.visible).toBe(true);
  spot.shadow.updateMatrices(spot);const matrix=spot.shadow.matrix.clone();camera.position.x=8;camera.lookAt(0,0,0);camera.updateMatrixWorld();pass.flush(camera);
  expect(reports.at(-1)?.updates).toBe(1);spot.shadow.updateMatrices(spot);expect(spot.shadow.matrix.equals(matrix)).toBe(true);
  // A real variant swap invalidates the map; it keeps the same world capture.
  sculpture.geometry.setIndex(new three.BufferAttribute(new Uint32Array(300000),1));pass.invalidate();pass.flush(camera);
  expect(reports.at(-1)).toMatchObject({targetTriangles:100012,targetCasters:2,omittedTargetCasters:0,updates:2});
  expect(support.castShadow).toBe(true);
  sculpture.geometry.setIndex(new three.BufferAttribute(new Uint32Array(SHADOW_TRIANGLE_LIMIT*3),1));pass.invalidate();pass.flush(camera);
  expect(reports.at(-1)).toMatchObject({targetTriangles:SHADOW_TRIANGLE_LIMIT,targetCasters:1,omittedTargetCasters:1,updates:3});
  expect(support.castShadow).toBe(false);spot.shadow.updateMatrices(spot);expect(spot.shadow.matrix.equals(matrix)).toBe(true);
  pass.dispose();expect(sculpture.castShadow||support.receiveShadow||glass.castShadow).toBe(false);
});
test('target omission accounting includes the receiver cap as well as the caster cap',()=>{
  const h=setup();h.pass.dispose();h.room.remove(h.mesh);
  const target=new three.Group(),targetPlacementId=crypto.randomUUID();target.userData.placementId=targetPlacementId;h.room.add(target);
  const geometry=new three.BoxGeometry(),material=new three.MeshStandardMaterial();
  for(let i=0;i<257;i++)target.add(new three.Mesh(geometry,material));
  const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true,targetPlacementId}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();expect(reports.at(-1)).toMatchObject({targetCasters:64,targetTriangles:768,omittedTargetCasters:193});
  expect(target.children.filter(mesh=>(mesh as three.Mesh).castShadow)).toHaveLength(64);
  pass.dispose();geometry.dispose();material.dispose();
});
test('independently authored sculpture lights in two rooms both retain stable cached maps',()=>{
  const h=setup();h.pass.dispose();
  const other=new three.Group();other.position.x=8;const secondMesh=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial());other.add(secondMesh);
  const first=new three.SpotLight(),second=new three.SpotLight();first.position.set(0,4,-2);second.position.set(0,4,-2);h.room.add(first,first.target);other.add(second,second.target);
  first.angle=Math.PI/6;second.angle=Math.PI/6;
  const fixed=new three.Box3(new three.Vector3(-5,-3,-5),new three.Vector3(13,5,5));
  const reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:first,authoredCastShadow:true,sourceLightId:'first'},{room:other,light:second,authoredCastShadow:true,sourceLightId:'second'}],false,2*SHADOW_RESERVE_BYTES,r=>reports.push(r),fixed);
  pass.flush(contactView());expect(first.castShadow).toBe(true);expect(second.castShadow).toBe(true);
  expect(reports.at(-1)).toMatchObject({mapCount:2,mapBytes:2*SHADOW_RESERVE_BYTES,requestedSources:2,deferredSources:0,sources:[{sourceLightId:'first',casters:1},{sourceLightId:'second',casters:1}]});
  expect(h.mesh.castShadow&&secondMesh.castShadow).toBe(true);
  first.shadow.updateMatrices(first);second.shadow.updateMatrices(second);const before=[first.shadow.matrix.clone(),second.shadow.matrix.clone()];
  const camera=contactView(8);pass.flush(camera);expect(first.shadow.matrix.equals(before[0]!)).toBe(true);expect(second.shadow.matrix.equals(before[1]!)).toBe(true);
  pass.dispose();expect(first.castShadow||second.castShadow||h.mesh.castShadow||secondMesh.castShadow).toBe(false);
});
test('two independent100k bodies retain their real supports while repeated structural depth work stays bounded',()=>{
  const h=setup();h.pass.dispose();h.room.remove(h.mesh);
  const other=new three.Group();other.position.x=8;const rooms=[h.room,other],reports:ShadowReport[]=[],bodies:three.Mesh[]=[],supports:three.Mesh[]=[],candidates=[];
  for(const room of rooms){const id=crypto.randomUUID(),target=new three.Group();target.userData.placementId=id;room.add(target);
    const geometry=new three.BoxGeometry();geometry.setIndex(new three.BufferAttribute(new Uint32Array(300000),1));const body=new three.Mesh(geometry,new three.MeshStandardMaterial()),support=new three.Mesh(new three.BoxGeometry(.5,1,.5),new three.MeshStandardMaterial());support.position.y=-1;target.add(body,support);bodies.push(body);supports.push(support);
    const light=new three.SpotLight();light.position.set(0,4,-2);light.angle=Math.PI/6;room.add(light,light.target);candidates.push({room,light,authoredCastShadow:true,targetPlacementId:id});
  }
  const structure=new three.Mesh(new three.BoxGeometry(14,1,14),new three.MeshStandardMaterial());structure.position.set(4,-2,0);structure.geometry.setIndex(new three.BufferAttribute(new Uint32Array(90000),1));h.room.add(structure);
  const fixed=new three.Box3(new three.Vector3(-5,-3,-7),new three.Vector3(13,5,7)),pass=installBoundedShadows(three,h.renderer,candidates,false,2*SHADOW_RESERVE_BYTES,r=>reports.push(r),fixed);
  pass.flush(contactView());expect([...bodies,...supports].every(mesh=>mesh.castShadow)).toBe(true);expect(structure.castShadow).toBe(false);expect(structure.receiveShadow).toBe(true);
  expect(reports.at(-1)).toMatchObject({mapCount:2,casters:4,triangles:200024,omittedCasters:1,sources:[{targetCasters:2,targetTriangles:100012,omittedTargetCasters:0},{targetCasters:2,targetTriangles:100012,omittedTargetCasters:0}]});
  expect(reports.at(-1)!.sources!.reduce((sum,row)=>sum+row.triangles,0)).toBeLessThanOrEqual(SHADOW_TRIANGLE_LIMIT);
  const updates=reports.at(-1)!.updates;pass.flush(contactView(8));expect(reports.at(-1)!.updates).toBe(updates);
  pass.dispose();for(const mesh of [...bodies,...supports,structure]){mesh.geometry.dispose();(mesh.material as three.Material).dispose();}
});
test('a pooled source beyond the available map memory is deferred and released on preference changes',()=>{
  const h=setup();h.pass.dispose();
  const second=new three.DirectionalLight();second.position.set(-4,8,4);h.room.add(second,second.target);
  const candidates=[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}];
  const reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,h.renderer,candidates,false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();expect(reports.at(-1)).toMatchObject({mapCount:1,mapBytes:SHADOW_RESERVE_BYTES,deferredSources:1});
  expect(h.light.castShadow).toBe(true);expect(second.castShadow).toBe(false);
  const map=new three.WebGLRenderTarget(512,512);h.light.shadow.map=map;const released=vi.fn();map.addEventListener('dispose',released);
  candidates[0]!.authoredCastShadow=false;pass.invalidate();pass.flush();
  expect(released).toHaveBeenCalledOnce();expect(h.light.shadow.map).toBeNull();expect(h.light.castShadow).toBe(false);expect(second.castShadow).toBe(true);
  pass.dispose();expect(second.castShadow).toBe(false);
});
test('multiple material groups share the global depth draw allowance across pooled maps',()=>{
  const h=setup();h.pass.dispose();h.room.remove(h.mesh);
  const geometry=new three.BoxGeometry(),materials=[new three.MeshStandardMaterial(),new three.MeshStandardMaterial()];
  // Two actual groups rather than counting this multi-material mesh as one draw.
  geometry.clearGroups();geometry.addGroup(0,18,0);geometry.addGroup(18,18,1);
  const grouped=new three.Mesh(geometry,materials),extra=new three.Mesh(new three.BoxGeometry(),materials[0]);h.room.add(grouped,extra);
  const second=new three.DirectionalLight();second.position.set(-4,8,4);h.room.add(second,second.target);
  const reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}],false,2*SHADOW_RESERVE_BYTES,r=>reports.push(r),undefined,4);
  pass.flush();expect(grouped.castShadow).toBe(true);expect(extra.castShadow).toBe(false);
  expect(reports.at(-1)).toMatchObject({casters:1,omittedCasters:1,mapCount:2,sources:[{depthDraws:2},{depthDraws:2}]});
  expect(reports.at(-1)!.sources!.reduce((sum,row)=>sum+row.depthDraws,0)).toBe(4);
  pass.dispose();geometry.dispose();for(const material of materials)material.dispose();extra.geometry.dispose();
});
test('optional maps use idle owner bytes and dispose their target before required display regains its hold',()=>{
  const h=setup();h.pass.dispose();const second=new three.DirectionalLight();second.position.set(-4,8,4);h.room.add(second,second.target);
  const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  let resident=SHADOW_RESERVE_BYTES;const limit=3*SHADOW_RESERVE_BYTES,ledger=new AssetPeakBudget(limit,()=>resident);
  ledger.reserve('required-pending',SHADOW_RESERVE_BYTES+1);
  expect(leaseOptionalShadowMaps(pass,2,ledger,limit)).toBeUndefined();
  expect(ledger.total()).toBe(2*SHADOW_RESERVE_BYTES+1);
  ledger.release('required-pending');const release=leaseOptionalShadowMaps(pass,2,ledger,limit)!;
  expect(ledger.total()).toBe(2*SHADOW_RESERVE_BYTES);pass.flush();expect(second.castShadow).toBe(true);
  const map=new three.WebGLRenderTarget(512,512);second.shadow.map=map;let freed=false;
  map.addEventListener('dispose',()=>{expect(ledger.reservationBytes('viewer:optional-shadow-maps')).toBe(SHADOW_RESERVE_BYTES);freed=true;});
  release();release();expect(freed).toBe(true);expect(second.shadow.map).toBeNull();expect(second.castShadow).toBe(false);
  // The unchanged full display fits again without eviction or LOD replacement.
  expect(ledger.total()).toBe(resident);ledger.reserve('full-display',2*SHADOW_RESERVE_BYTES);expect(ledger.total()).toBe(limit);
  resident=0;pass.flush();expect(reports.at(-1)).toMatchObject({mapCount:1,deferredSources:1});pass.dispose();
});
test('a settled visible working set can borrow the second map while off-room artworks remain unloaded',()=>{
 const h=setup();h.pass.dispose();const second=new three.DirectionalLight();second.position.set(-4,8,4);h.room.add(second,second.target);
 const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r)),ledger=new AssetPeakBudget(3*SHADOW_RESERVE_BYTES,()=>SHADOW_RESERVE_BYTES);
 const models=Array.from({length:19},(_,i)=>({required:i<3,ready:i<3}));pass.flush();expect(reports.at(-1)).toMatchObject({mapCount:1,deferredSources:1});
 const attempt=()=>shadowWorkingSetReady(models)?leaseOptionalShadowMaps(pass,2,ledger,3*SHADOW_RESERVE_BYTES):undefined;
 models[2]!.ready=false;expect(attempt()).toBeUndefined();expect(ledger.reservedBytes()).toBe(0);
 models[2]!.ready=true;ledger.reserve('required-pending',SHADOW_RESERVE_BYTES+1);expect(attempt()).toBeUndefined();ledger.release('required-pending');
 const release=attempt()!;expect(release.bytes).toBe(SHADOW_RESERVE_BYTES);pass.flush();expect(reports.at(-1)).toMatchObject({mapCount:2,deferredSources:0,mapBytes:2*SHADOW_RESERVE_BYTES});
 release();pass.flush();expect(reports.at(-1)).toMatchObject({mapCount:1,deferredSources:1});expect(ledger.reservedBytes()).toBe(0);
 for(const model of models)model.required=false;expect(attempt()).toBeUndefined();pass.dispose();
});
test('overlapping material groups cannot bypass the existing triangle bound',()=>{
  const h=setup(),geometry=new three.BoxGeometry();geometry.setIndex(new three.BufferAttribute(new Uint32Array(390000),1));
  geometry.clearGroups();geometry.addGroup(0,390000,0);geometry.addGroup(0,390000,1);
  const materials=[new three.MeshStandardMaterial(),new three.MeshStandardMaterial()],repeated=new three.Mesh(geometry,materials);h.room.add(repeated);
  h.pass.flush();expect(h.mesh.castShadow).toBe(true);expect(repeated.castShadow).toBe(false);
  expect(h.reports.at(-1)).toMatchObject({casters:1,triangles:12,omittedCasters:1});
  h.pass.dispose();geometry.dispose();for(const material of materials)material.dispose();
});
test('the pool counts repeated caster triangles across maps against the bounded dirty depth allowance',()=>{
  const h=setup();h.pass.dispose();
  const second=new three.DirectionalLight();second.position.set(-4,8,4);h.room.add(second,second.target);
  const geometry=new three.BoxGeometry();geometry.setIndex(new three.BufferAttribute(new Uint32Array(390000),1));
  const mesh=new three.Mesh(geometry,new three.MeshStandardMaterial());h.room.add(mesh);
  const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}],false,2*SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();expect(mesh.castShadow).toBe(false);expect(h.mesh.castShadow).toBe(true);
  expect(reports.at(-1)).toMatchObject({casters:1,triangles:12,omittedCasters:1});
  expect(reports.at(-1)!.sources!.reduce((sum,row)=>sum+row.triangles,0)).toBe(24);
  pass.dispose();geometry.dispose();mesh.material.dispose();
});
test('depth work uses the renderer sphere predicate when a tighter mesh box misses a map',()=>{
  const h=setup();h.pass.dispose();const second=new three.SpotLight();second.position.set(0,4,-2);second.angle=.1;h.room.add(second,second.target);
  const geometry=new three.BoxGeometry(.1,10,.1);geometry.setIndex(new three.BufferAttribute(new Uint32Array(390000),1));
  const mesh=new three.Mesh(geometry,new three.MeshStandardMaterial());mesh.position.x=3;h.room.add(mesh);
  const fixed=new three.Box3(new three.Vector3(-5,-6,-5),new three.Vector3(5,6,5));
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light,authoredCastShadow:true},{room:h.room,light:second,authoredCastShadow:true}],false,2*SHADOW_RESERVE_BYTES,()=>{},fixed);
  pass.flush();const camera=second.shadow.camera,frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  expect(frustum.intersectsBox(new three.Box3().setFromObject(mesh))).toBe(false);expect(mesh.intersectsFrustum(frustum)).toBe(true);
  expect(mesh.castShadow).toBe(false);expect(h.mesh.castShadow).toBe(true);
  pass.dispose();geometry.dispose();mesh.material.dispose();
});
test('the global two-map pool defers additional sources without reserving unused maps',()=>{
  const h=setup();h.pass.dispose();
  const lights=Array.from({length:3},(_,i)=>{const light=new three.DirectionalLight();light.position.set(i-1,8,4);h.room.add(light,light.target);return light;});
  const reports:ShadowReport[]=[],pass=installBoundedShadows(three,h.renderer,lights.map(light=>({room:h.room,light,authoredCastShadow:true})),false,3*SHADOW_RESERVE_BYTES,r=>reports.push(r));
  pass.flush();expect(lights.map(light=>light.castShadow)).toEqual([true,true,false]);
  expect(reports.at(-1)).toMatchObject({requestedSources:3,deferredSources:1,mapCount:2,mapBytes:2*SHADOW_RESERVE_BYTES});
  const ledger=new AssetPeakBudget(10*SHADOW_RESERVE_BYTES,()=>0),release=leaseOptionalShadowMaps(pass,3,ledger,10*SHADOW_RESERVE_BYTES)!;
  expect(release.bytes).toBe(SHADOW_RESERVE_BYTES);expect(ledger.reservedBytes()).toBe(SHADOW_RESERVE_BYTES);
  release();pass.dispose();
});
test('camera crossing a doorway keeps both receivers, authored source and map identity',()=>{
  const h=setup();h.pass.dispose();
  const other=new three.Group(),mesh=new three.Mesh(new three.BoxGeometry(),h.mesh.material),spot=new three.SpotLight();
  other.position.x=8;spot.position.set(2,4,3);other.add(mesh,spot,spot.target);
  const reports:ShadowReport[]=[];
  const pass=installBoundedShadows(three,h.renderer,[{room:other,light:spot},{room:h.room,light:h.light}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r));
  const camera=new three.PerspectiveCamera(75,1,.1,100);camera.position.set(4,1,3);camera.lookAt(4,0,0);
  pass.flush(camera);expect(h.light.castShadow).toBe(true);expect(spot.castShadow).toBe(false);
  expect(h.mesh.receiveShadow&&mesh.receiveShadow).toBe(true);
  const map=new three.WebGLRenderTarget(512,512);h.light.shadow.map=map;
  let freed=0;map.addEventListener('dispose',()=>freed++);
  camera.position.x+=.02;pass.flush(camera);
  expect(reports).toHaveLength(1);expect(h.light.shadow.map).toBe(map);expect(freed).toBe(0);
  camera.position.x+=6.1;pass.flush(camera);expect(reports.at(-1)?.updates).toBe(2);
  expect(h.light.shadow.map).toBe(map);expect(h.mesh.receiveShadow&&mesh.receiveShadow).toBe(true);
  pass.dispose();expect(freed).toBe(1);
});

test('an initial camera outside scene bounds can enter and recover without a room label or invalidation',()=>{
  const h=setup(),camera=new three.PerspectiveCamera(70,1,.1,200);camera.position.set(100,1,3);camera.lookAt(0,0,0);
  h.pass.flush(camera);expect(h.reports.at(-1)?.mode).toBe('unavailable');
  h.pass.flush(camera);expect(h.reports).toHaveLength(1);
  camera.position.set(0,1,3);camera.lookAt(0,0,0);h.pass.flush(camera);
  expect(h.reports.at(-1)).toMatchObject({mode:'bounded',mapSize:512,casters:1,updates:1});h.pass.dispose();
});

test('fixed world capture keeps architecture and projection stable through walking, turning, FOV and refresh',()=>{
  const h=setup();h.pass.dispose();h.room.remove(h.mesh);
  const images=Array.from({length:270},(_,i)=>{const mesh=new three.Mesh(new three.PlaneGeometry(1,1),new three.MeshStandardMaterial());mesh.position.set((i%10)*.1,1,0);mesh.userData.viewerArtworkType='image';h.room.add(mesh);return mesh;});
  const walls=Array.from({length:50},(_,i)=>{const mesh=new three.Mesh(new three.PlaneGeometry(1,1),new three.MeshStandardMaterial());mesh.position.set((i%10)-4.5,1,1);mesh.userData.exhibitosShadowArchitecture=true;h.room.add(mesh);return mesh;});
  const reports:ShadowReport[]=[],bounds=new three.Box3(new three.Vector3(-5,0,-12),new three.Vector3(18,4,2));
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:h.light}],false,SHADOW_RESERVE_BYTES,r=>reports.push(r),bounds);
  const camera=contactView();pass.flush(camera);h.light.shadow.updateMatrices(h.light);
  const selected=images.filter(mesh=>mesh.castShadow),projection=h.light.shadow.camera.projectionMatrix.clone(),matrix=h.light.shadow.matrix.clone(),bias=h.light.shadow.normalBias;
  expect(walls.every(mesh=>mesh.castShadow&&mesh.receiveShadow)).toBe(true);expect(selected).toHaveLength(14);
  for(const x of [.5,2,7,12]){
    camera.position.x=x;camera.lookAt(-5,1,-2);camera.fov=90;camera.updateProjectionMatrix();pass.flush(camera);
    pass.invalidate();pass.flush(camera);h.light.shadow.updateMatrices(h.light);
    expect(h.light.shadow.camera.projectionMatrix.equals(projection)).toBe(true);expect(h.light.shadow.matrix.equals(matrix)).toBe(true);
    expect(h.light.shadow.normalBias).toBe(bias);expect(images.filter(mesh=>mesh.castShadow)).toEqual(selected);
    expect(walls.every(mesh=>mesh.castShadow&&mesh.receiveShadow)).toBe(true);
    expect(reports.at(-1)).toMatchObject({mode:'bounded',mapSize:512,casters:64,triangles:128});
  }
  expect(h.light.position.toArray()).toEqual([4,8,4]);pass.dispose();
});

test('near-field content invalidation preserves the old anchor until movement exceeds six metres',()=>{
  const h=setup();h.mesh.geometry=new three.BoxGeometry(60,2,60);const camera=contactView();
  h.pass.flush(camera);h.light.shadow.updateMatrices(h.light);const original=h.light.shadow.matrix.clone();
  for(const x of [.5,1,3,5.9]){camera.position.x=x;h.pass.invalidate();h.pass.flush(camera);h.light.shadow.updateMatrices(h.light);expect(h.light.shadow.matrix.equals(original)).toBe(true);}
  camera.position.x=6.1;h.pass.flush(camera);h.light.shadow.updateMatrices(h.light);expect(h.light.shadow.matrix.equals(original)).toBe(false);h.pass.dispose();
});

test('a failed earlier source cannot move the retained near-field anchor for the valid source',()=>{
  const h=setup();h.pass.dispose();h.mesh.geometry=new three.BoxGeometry(60,2,60);
  const far=new three.DirectionalLight(0xffffff,0);far.position.set(1000,1000,1000);h.room.add(far,far.target);
  const spot=new three.SpotLight();spot.position.set(4,8,4);h.room.add(spot,spot.target);
  const pass=installBoundedShadows(three,h.renderer,[{room:h.room,light:far},{room:h.room,light:spot}],false,SHADOW_RESERVE_BYTES,()=>{}),camera=contactView();
  pass.flush(camera);spot.shadow.updateMatrices(spot);const original=spot.shadow.matrix.clone();expect(spot.castShadow).toBe(true);
  camera.position.x=1;far.intensity=1;pass.invalidate();pass.flush(camera);spot.shadow.updateMatrices(spot);
  expect(far.castShadow).toBe(false);expect(spot.castShadow).toBe(true);expect(spot.shadow.matrix.equals(original)).toBe(true);pass.dispose();
});

test('planarity result is reused until position or index versions change',()=>{
  const h=setup();h.mesh.geometry=new three.PlaneGeometry(1,1);
  const position=h.mesh.geometry.getAttribute('position'),read=vi.spyOn(position,'getX');
  h.pass.flush();const first=read.mock.calls.length;expect(first).toBeGreaterThan(0);
  h.pass.invalidate();h.pass.flush();expect(read.mock.calls.length).toBe(first);
  position.setZ(0,.1);position.needsUpdate=true;h.pass.invalidate();h.pass.flush();
  expect(read.mock.calls.length).toBeGreaterThan(first);expect(h.mesh.onBeforeShadow).toBe(three.Object3D.prototype.onBeforeShadow);
  h.pass.dispose();
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
  h.mesh.material.transparent=false;h.mesh.geometry.setIndex(new three.BufferAttribute(new Uint32Array((SHADOW_TRIANGLE_LIMIT+1)*3),1));h.pass.invalidate();h.pass.flush();
  expect(h.reports.at(-1)?.mode).toBe('unavailable');expect(h.room.children).toContain(h.mesh);expect(h.mesh.geometry.index?.count).toBe((SHADOW_TRIANGLE_LIMIT+1)*3);h.pass.dispose();
});
test('one oversized caster does not disable other bounded room shadows or change visible geometry',()=>{const h=setup(),mesh=new three.InstancedMesh(new three.BoxGeometry(1,1,1),h.mesh.material,22000),identity=new three.Matrix4();for(let i=0;i<22000;i++)mesh.setMatrixAt(i,identity);mesh.computeBoundingBox();mesh.computeBoundingSphere();h.room.add(mesh);h.pass.flush();expect(h.reports.at(-1)?.mode).toBe('bounded');expect(h.reports.at(-1)?.omittedCasters).toBe(1);expect(h.reports.at(-1)!.triangles).toBeLessThanOrEqual(SHADOW_TRIANGLE_LIMIT);expect(mesh.castShadow).toBe(false);expect(mesh.receiveShadow).toBe(true);expect(h.mesh.castShadow).toBe(true);expect(h.room.children).toContain(mesh);expect(mesh.count).toBe(22000);h.pass.dispose();mesh.dispose();mesh.geometry.dispose();});

function contactView(x=0){
  const camera=new three.PerspectiveCamera(70,1,.1,100);camera.position.set(x,1,3);camera.lookAt(x,0,0);camera.updateMatrixWorld();return camera;
}
function contactRow(room:three.Group,receiver:three.Object3D,x=0):SupportContact{
  return {room,receiver,position:[x,.002,0],rotation:[0,0,0,1],width:.2,height:.2};
}
test('view contacts add no draws or textures and retain shader ownership across ordinary view changes',()=>{
  const h=setup(),other=new three.Group(),otherMesh=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial());
  other.position.x=20;other.add(otherMesh);
  const reports:unknown[]=[],before=h.mesh.material.onBeforeCompile,key=h.mesh.material.customProgramCacheKey;
  const color=h.mesh.material.color.clone(),children=h.room.children.slice();let releases=0;
  h.mesh.material.addEventListener('dispose',()=>releases++);
  const pass=installSupportContactShadows(three,[...Array.from({length:10},()=>contactRow(h.room,h.mesh)),contactRow(other,otherMesh)],false,r=>reports.push(r));
  const camera=contactView();pass.setView(camera);
  expect(h.room.children).toEqual(children);expect(h.mesh.material.color).toEqual(color);expect(h.mesh.material.transparent).toBe(false);
  expect(reports.at(-1)).toEqual({activeContacts:8,activeTriangles:0,drawCalls:0,textureBytes:0,uniformBytes:520,materials:1,programBytes:null});
  const owned=h.mesh.material.onBeforeCompile,version=h.mesh.material.version;
  const shader={uniforms:{},vertexShader:three.ShaderLib.standard.vertexShader,fragmentShader:three.ShaderLib.standard.fragmentShader};
  owned.call(h.mesh.material,shader as Parameters<three.Material['onBeforeCompile']>[0],h.renderer);
  expect(shader.vertexShader).toContain('vExhibitosContactWorld=(modelMatrix*contactWorld).xyz');
  expect(shader.fragmentShader).toContain('contactStrength=max(contactStrength,support*support)');
  expect(shader.fragmentShader).toContain('dot(contactNormal,planeNormal)>0.5');expect(shader.uniforms).toHaveProperty('exhibitosContactCount.value',8);
  camera.position.x+=.02;pass.setView(camera);expect(h.mesh.material.version).toBe(version);
  pass.setView(contactView(20));expect(releases).toBe(0);expect(h.mesh.material.onBeforeCompile).toBe(owned);
  expect(shader.uniforms).toHaveProperty('exhibitosContactCount.value',0);
  expect(reports.at(-1)).toMatchObject({activeContacts:1,materials:2,uniformBytes:1040});
  pass.setView(contactView());expect(h.mesh.material.version).toBe(version);expect(shader.uniforms).toHaveProperty('exhibitosContactCount.value',8);
  pass.setView(contactView(20));pass.dispose();pass.dispose();expect(releases).toBe(1);
  expect(h.mesh.material.onBeforeCompile).toBe(before);expect(h.mesh.material.customProgramCacheKey).toBe(key);
  expect(h.mesh.material.userData.exhibitosSupportContact).toBeUndefined();expect(shader.uniforms).toHaveProperty('exhibitosContactCount.value',0);h.pass.dispose();
});

test('both profiles select visible contacts before crossing rooms and scope uniforms by physical material',()=>{
  for(const compact of [false,true]){
    const h=setup(),other=new three.Group(),receiver=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial());other.position.x=1;other.add(receiver);
    const reports:unknown[]=[],pass=installSupportContactShadows(three,[contactRow(h.room,h.mesh),contactRow(other,receiver),{...contactRow(h.room,h.mesh),width:Infinity}],compact,r=>reports.push(r));
    pass.setView(contactView());expect(reports.at(-1)).toMatchObject({activeContacts:2,materials:2,uniformBytes:1040});
    const uniforms=h.mesh.material.userData.exhibitosSupportContact,otherUniforms=receiver.material.userData.exhibitosSupportContact;
    expect(uniforms).not.toBe(otherUniforms);expect(uniforms.exhibitosContactCount.value).toBe(1);
    expect(uniforms.exhibitosContactOpacity.value).toBe(compact?.18:.14);
    expect(uniforms.exhibitosContactMatrices.value[0].elements[12]).toBeCloseTo(0);
    expect(otherUniforms.exhibitosContactMatrices.value[0].elements[12]).toBeCloseTo(-5);
    pass.dispose();const custom=()=>{};h.mesh.material.onBeforeCompile=custom;
    const declined=installSupportContactShadows(three,[contactRow(h.room,h.mesh)],compact,r=>reports.push(r));declined.setView(contactView());
    expect(reports.at(-1)).toMatchObject({activeContacts:0,materials:0});declined.dispose();expect(h.mesh.material.onBeforeCompile).toBe(custom);h.pass.dispose();
  }
});

test('known nondeforming contact shading preserves bounded planar shadow policy',()=>{
  const h=setup();h.mesh.geometry=new three.PlaneGeometry(2,2);h.mesh.material.side=three.DoubleSide;
  const pass=installSupportContactShadows(three,[contactRow(h.room,h.mesh)],false,()=>{});pass.setView(contactView());h.pass.flush();
  expect(h.mesh.castShadow).toBe(true);expect(h.mesh.onBeforeShadow).not.toBe(three.Object3D.prototype.onBeforeShadow);pass.dispose();h.pass.dispose();
});

test('late descriptors are not consumed by earlier offscreen contacts and lifetime material ownership stays bounded',()=>{
  const h=setup(),rooms=Array.from({length:20},(_,i)=>{const room=new three.Group();room.position.x=i*20;const mesh=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial());room.add(mesh);return {room,mesh};});
  const rows=rooms.map(({room,mesh})=>contactRow(room,mesh)),reports:unknown[]=[];
  const pass=installSupportContactShadows(three,rows,false,r=>reports.push(r));
  pass.setView(contactView(380));expect(reports.at(-1)).toMatchObject({activeContacts:1,materials:1});
  let retired=0;for(const {mesh}of rooms)mesh.material.addEventListener('dispose',()=>retired++);
  for(let i=0;i<20;i++){pass.setView(contactView(i*20));expect(rooms[i]!.mesh.material.userData.exhibitosSupportContact.exhibitosContactCount.value).toBe(1);}
  expect(reports.at(-1)).toMatchObject({activeContacts:1,materials:16,uniformBytes:8320});expect(retired).toBe(5);
  pass.dispose();expect(retired).toBe(21);h.pass.dispose();
});

test('final retirement admits fresh uniforms instead of reusing a prior controller cache',()=>{
  const h=setup(),row=contactRow(h.room,h.mesh);
  const first=installSupportContactShadows(three,[row],false,()=>{});first.setView(contactView());
  const old=h.mesh.material.userData.exhibitosSupportContact;first.dispose();
  const next=installSupportContactShadows(three,[row],false,()=>{});next.setView(contactView());
  expect(h.mesh.material.userData.exhibitosSupportContact).not.toBe(old);expect(old.exhibitosContactCount.value).toBe(0);
  next.dispose();h.pass.dispose();
});

test('a saturated material cache admits all newly visible masks on the first view update',()=>{
  const h=setup(),rows:SupportContact[]=[],materials:three.MeshStandardMaterial[]=[];
  for(let i=0;i<24;i++){
    const room=new three.Group(),material=new three.MeshStandardMaterial(),mesh=new three.Mesh(new three.BoxGeometry(),material);
    room.position.x=i<16?i*20:400+(i-16)*.1;room.add(mesh);materials.push(material);rows.push(contactRow(room,mesh));
  }
  const reports:unknown[]=[],pass=installSupportContactShadows(three,rows,false,r=>reports.push(r));
  for(let i=0;i<16;i++)pass.setView(contactView(i*20));
  let retired=0;for(const material of materials)material.addEventListener('dispose',()=>retired++);
  pass.setView(contactView(400));
  expect(reports.at(-1)).toMatchObject({activeContacts:8,materials:16,uniformBytes:8320});expect(retired).toBe(8);
  for(const material of materials.slice(16))expect(material.userData.exhibitosSupportContact.exhibitosContactCount.value).toBe(1);
  pass.setView(contactView(400));expect(retired).toBe(8);
  pass.dispose();expect(retired).toBe(24);h.pass.dispose();
});

test('authority visibility descriptor refresh removes and restores masks without retiring material programs at a stationary view',()=>{
  const h=setup(),row=contactRow(h.room,h.mesh),camera=contactView(),reports:unknown[]=[];
  const pass=installSupportContactShadows(three,[row],false,r=>reports.push(r));pass.setView(camera);
  const owned=h.mesh.material.onBeforeCompile,key=h.mesh.material.customProgramCacheKey,version=h.mesh.material.version;
  const uniforms=h.mesh.material.userData.exhibitosSupportContact;let retired=0;h.mesh.material.addEventListener('dispose',()=>retired++);
  pass.setContacts([]);pass.setView(camera);expect(uniforms.exhibitosContactCount.value).toBe(0);
  expect(reports.at(-1)).toMatchObject({activeContacts:0,materials:1});
  pass.setContacts([{...row,position:[.1,.002,0]}]);pass.setView(camera);
  expect(uniforms.exhibitosContactCount.value).toBe(1);expect(uniforms.exhibitosContactMatrices.value[0].elements[12]).toBeCloseTo(-.5);
  expect(h.mesh.material.onBeforeCompile).toBe(owned);expect(h.mesh.material.customProgramCacheKey).toBe(key);
  expect(h.mesh.material.version).toBe(version);expect(retired).toBe(0);
  pass.setContacts([]);pass.setView(camera);pass.dispose();expect(retired).toBe(1);h.pass.dispose();
});

test('same-pose descriptor hide/restore retains unchanged receiver-local support masks',()=>{
  const h=setup(),rows=[...Array.from({length:7},()=>contactRow(h.room,h.mesh)),contactRow(h.room,h.mesh,1),contactRow(h.room,h.mesh,-1)];
  const pass=installSupportContactShadows(three,rows,false,()=>{});pass.setView(contactView(.4));pass.setView(contactView(-.4));
  const uniforms=h.mesh.material.userData.exhibitosSupportContact;
  const retained=()=>uniforms.exhibitosContactMatrices.value.slice(0,uniforms.exhibitosContactCount.value).map((matrix:three.Matrix4)=>matrix.elements[12]);
  expect(retained()).toContain(-5);expect(retained()).not.toContain(5);
  pass.setContacts(rows.slice(0,8));pass.setView(contactView(-.4));
  pass.setContacts(rows.map(row=>({...row,position:[...row.position],rotation:[...row.rotation]})));pass.setView(contactView(-.4));
  expect(retained()).toContain(-5);expect(retained()).not.toContain(5);expect(uniforms.exhibitosContactCount.value).toBe(8);
  pass.dispose();h.pass.dispose();
});

test('two visible receiver materials each retain eight world masks as the camera moves and turns',()=>{
  const h=setup(),second=new three.Mesh(new three.BoxGeometry(1,1,1),new three.MeshStandardMaterial());second.position.x=.5;h.room.add(second);
  const a=Array.from({length:8},(_,i)=>contactRow(h.room,h.mesh,-.5-i*.01)),b=Array.from({length:8},(_,i)=>contactRow(h.room,second,.5+i*.01)),reports:unknown[]=[];
  const pass=installSupportContactShadows(three,[...a,...b],false,r=>reports.push(r));pass.setView(contactView());
  const first=h.mesh.material.userData.exhibitosSupportContact,other=second.material.userData.exhibitosSupportContact;
  const values=(uniforms:typeof first)=>uniforms.exhibitosContactMatrices.value.map((m:three.Matrix4)=>m.toArray());
  const original=values(first),originalOther=values(other);
  expect(reports.at(-1)).toMatchObject({activeContacts:16,materials:2,uniformBytes:1040});
  for(const x of [.4,.6,-.4]){const camera=contactView(x);camera.lookAt(0,0,0);camera.updateMatrixWorld();pass.setView(camera);
    expect(first.exhibitosContactCount.value).toBe(8);expect(other.exhibitosContactCount.value).toBe(8);
    expect(values(first)).toEqual(original);expect(values(other)).toEqual(originalOther);
  }
  pass.dispose();h.pass.dispose();
});

test('a visible receiver does not lose its fixed contact when the camera crosses twelve metres',()=>{
  const h=setup();h.mesh.geometry=new three.BoxGeometry(40,.1,40);
  const pass=installSupportContactShadows(three,[contactRow(h.room,h.mesh)],false,()=>{});
  for(const z of [11.9,12.1,13]){const camera=new three.PerspectiveCamera(70,1,.1,100);camera.position.set(0,1,z);camera.lookAt(0,0,0);camera.updateMatrixWorld();pass.setView(camera);expect(h.mesh.material.userData.exhibitosSupportContact.exhibitosContactCount.value).toBe(1);}
  pass.dispose();h.pass.dispose();
});

test('rectangular support packs shape in unused GPU w components without changing xyz or normal transforms',()=>{
  const h=setup(),row={...contactRow(h.room,h.mesh),width:.72,height:.72,shape:{kind:'rectangle' as const,width:.65,height:.65}};
  const pass=installSupportContactShadows(three,[row],false,()=>{});pass.setView(contactView());
  const uniforms=h.mesh.material.userData.exhibitosSupportContact,matrix=uniforms.exhibitosContactMatrices.value[0] as three.Matrix4;
  const affine=new three.Matrix4().compose(new three.Vector3().fromArray(row.position),new three.Quaternion().fromArray(row.rotation),new three.Vector3(row.width,row.height,1)).invert();
  for(const i of [0,1,2,4,5,6,8,9,10,12,13,14])expect(matrix.elements[i]).toBe(affine.elements[i]);
  expect(matrix.elements[3]).toBe(1);expect(matrix.elements[7]).toBeCloseTo(.65/.72);expect(matrix.elements[11]).toBeCloseTo(.65/.72);
  const shader={uniforms:{},vertexShader:three.ShaderLib.standard.vertexShader,fragmentShader:three.ShaderLib.standard.fragmentShader};
  h.mesh.material.onBeforeCompile(shader as Parameters<three.Material['onBeforeCompile']>[0],h.renderer);
  expect(shader.fragmentShader).toContain('contactMatrix[0][3]>0.5');expect(h.mesh.material.customProgramCacheKey()).toContain('exhibitos-support-contact-v3');
  const unchanged=matrix.toArray();pass.setView(contactView(.4));expect(matrix.toArray()).toEqual(unchanged);
  pass.setContacts([{...row,shape:{kind:'rectangle',width:.6,height:.65}}]);pass.setView(contactView(.4));expect(matrix.elements[7]).toBeCloseTo(.6/.72);
  pass.setContacts([{...row,shape:undefined}]);pass.setView(contactView(.4));expect(matrix.elements[3]).toBe(0);expect(matrix.elements[7]).toBe(0);expect(matrix.elements[11]).toBe(0);
  pass.dispose();h.pass.dispose();
});

test('removes floor contact when its physical support hides or detaches at a stationary camera',()=>{
  const h=setup(),support=new three.Mesh(new three.BoxGeometry(.2,.4,.2),new three.MeshStandardMaterial());
  h.room.add(support);
  const row={...contactRow(h.room,h.mesh),supports:[support]},camera=contactView();
  const pass=installSupportContactShadows(three,[row],false,()=>{});pass.setView(camera);
  const count=()=>h.mesh.material.userData.exhibitosSupportContact.exhibitosContactCount.value;
  expect(count()).toBe(1);
  support.visible=false;pass.setView(camera);expect(count()).toBe(0);
  support.visible=true;pass.setView(camera);expect(count()).toBe(1);
  support.removeFromParent();pass.setView(camera);expect(count()).toBe(0);
  pass.dispose();h.pass.dispose();support.geometry.dispose();support.material.dispose();
});

test('malformed rectangle extents are not admitted as GPU masks',()=>{
  const h=setup(),rows=[{...contactRow(h.room,h.mesh),shape:{kind:'rectangle' as const,width:.2,height:.1}},
    {...contactRow(h.room,h.mesh),shape:{kind:'rectangle' as const,width:NaN,height:.1}}];
  const pass=installSupportContactShadows(three,rows,false,()=>{});pass.setView(contactView());
  expect(h.mesh.material.userData.exhibitosSupportContact).toBeUndefined();pass.dispose();h.pass.dispose();
});
