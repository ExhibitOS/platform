// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';

// Installed r186 PCF uses one RGBA8 target and one uint32 depth texture, no mipmaps.
export const SHADOW_RESERVE_BYTES = 512 * 512 * 8;
/** r186 PCF: outer Vogel tap sqrt(4.5/5)*radius plus the hardware tap's
 * diagonal footprint. Express the receiver offset in fitted world units. */
export function directionalNormalBias(width:number,height:number,radius:number){
  return Math.max(.01,Math.max(width,height)/512*(Math.sqrt(.9)*radius+Math.SQRT2));
}
type Candidate = {light: THREE.DirectionalLight | THREE.SpotLight; room: THREE.Object3D};
export type ShadowReport = {mode:'bounded'|'compact'|'budget'|'unavailable';mapSize:number;casters:number;triangles:number;updates:number};

/** Inspect referenced positions, including arbitrarily oriented planes. No welding,
 * geometry edits or per-frame scan. Degenerate/deformed surfaces keep native policy. */
function planarGeometry(three:typeof THREE,geometry:THREE.BufferGeometry){
  const positions=geometry.getAttribute('position'),indices=geometry.index;
  const count=indices?.count??positions?.count??0;
  if(!positions||positions.itemSize!==3||count<3||count%3!==0)return false;
  const point=(i:number,out:THREE.Vector3)=>out.fromBufferAttribute(positions,indices?.getX(i)??i);
  const bounds=new three.Box3(),a=new three.Vector3(),b=new three.Vector3(),c=new three.Vector3();
  for(let i=0;i<count;i++){point(i,a);if(![a.x,a.y,a.z].every(Number.isFinite))return false;bounds.expandByPoint(a);}
  const span=bounds.getSize(a).length();if(!Number.isFinite(span)||span===0)return false;
  const plane=new three.Plane();let found=false;
  for(let i=0;i<count;i+=3){
    point(i,a);point(i+1,b);point(i+2,c);b.sub(a);c.sub(a);b.cross(c);
    if(b.lengthSq()>span**4*1e-12){plane.setFromNormalAndCoplanarPoint(b.normalize(),a);found=true;break;}
  }
  if(!found)return false;
  // Float32 coordinate tolerance must never admit a thin closed solid. Its
  // edge faces have different normals even if both broad faces fit the tolerance.
  for(let i=0;i<count;i+=3){
    point(i,a);point(i+1,b);point(i+2,c);b.sub(a);c.sub(a);b.cross(c);
    if(b.lengthSq()>span**4*1e-12&&Math.abs(b.normalize().dot(plane.normal))<1-1e-6)return false;
  }
  const magnitude=Math.max(...bounds.min.toArray().map(Math.abs),...bounds.max.toArray().map(Math.abs));
  const tolerance=Math.max(1e-9,span*1e-6,magnitude*2**-22);
  for(let i=0;i<count;i++)if(Math.abs(plane.distanceToPoint(point(i,a)))>tolerance)return false;
  return true;
}

/** One static depth pass in one existing room. Camera movement never invalidates it.
 * No point-light cube maps, new lights, authored material changes or full-scene pass. */
export function installBoundedShadows(three:typeof THREE,renderer:THREE.WebGLRenderer,
  candidates:Candidate[],compact:boolean,availableBytes:number,report:(value:ShadowReport)=>void) {
  let dirty=true,disposed=false,updates=0,selected:Candidate|undefined,capture:THREE.Box3|undefined;
  const original={enabled:renderer.shadowMap.enabled,autoUpdate:renderer.shadowMap.autoUpdate,type:renderer.shadowMap.type};
  const flags=new Map<THREE.Mesh,{cast:boolean;receive:boolean}>();
  const hooks=new Map<THREE.Mesh,{before:THREE.Mesh['onBeforeShadow'];after:THREE.Mesh['onAfterShadow'];ownedBefore:THREE.Mesh['onBeforeShadow'];ownedAfter:THREE.Mesh['onAfterShadow']}>();
  const depthSides=new Map<THREE.Material,THREE.Side>();
  const restoreDepth=(material:THREE.Material)=>{const side=depthSides.get(material);if(side!==undefined){material.side=side;depthSides.delete(material);}};
  const afterRender=()=>{for(const [material]of depthSides)restoreDepth(material);};
  const poses=new Map<THREE.DirectionalLight,{original:THREE.DirectionalLight['shadow']['updateMatrices'];proxy:THREE.DirectionalLight}>();
  const emit=(mode:ShadowReport['mode'],casters=0,triangles=0)=>report({mode,mapSize:mode==='bounded'?512:0,casters,triangles,updates});
  const releaseMap=(light:Candidate['light'])=>{light.castShadow=false;light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;if(light instanceof three.DirectionalLight){const pose=poses.get(light);if(pose){light.shadow.updateMatrices=pose.original;poses.delete(light);}}};
  const disabled=compact?'compact':availableBytes<SHADOW_RESERVE_BYTES?'budget':undefined;
  const restoreFlags=()=>{
    afterRender();
    for(const [mesh,old]of hooks){if(mesh.onBeforeShadow===old.ownedBefore)mesh.onBeforeShadow=old.before;if(mesh.onAfterShadow===old.ownedAfter)mesh.onAfterShadow=old.after;}hooks.clear();
    for(const [mesh,old]of flags){mesh.castShadow=old.cast;mesh.receiveShadow=old.receive;}flags.clear();
  };
  const installPlanarDepth=(mesh:THREE.Mesh)=>{
    const material=mesh.material;
    if(Array.isArray(material)||material.shadowSide!==null||material instanceof three.ShaderMaterial||
      material.onBeforeCompile!==three.Material.prototype.onBeforeCompile||
      mesh instanceof three.SkinnedMesh||mesh instanceof three.InstancedMesh||('isBatchedMesh'in mesh&&mesh.isBatchedMesh)||('isInstancedBufferGeometry'in mesh.geometry&&mesh.geometry.isInstancedBufferGeometry)||
      mesh.customDepthMaterial||mesh.customDistanceMaterial||
      mesh.onBeforeShadow!==three.Object3D.prototype.onBeforeShadow||mesh.onAfterShadow!==three.Object3D.prototype.onAfterShadow||
      Object.values(mesh.geometry.morphAttributes).some(attributes=>attributes.length>0)||
      ('displacementMap'in material&&material.displacementMap)||!planarGeometry(three,mesh.geometry))return;
    const before=mesh.onBeforeShadow,after=mesh.onAfterShadow;
    const ownedBefore:THREE.Mesh['onBeforeShadow']=(...args)=>{
      // r186 has already selected its cached depth material. Touch only this draw,
      // respecting explicit shadow-side edits made after the bounded pass was fitted.
      if(material.shadowSide!==null)return;
      const depth=args[5];if(!depthSides.has(depth))depthSides.set(depth,depth.side);depth.side=material.side;
    };
    const ownedAfter:THREE.Mesh['onAfterShadow']=(...args)=>restoreDepth(args[5]);
    hooks.set(mesh,{before,after,ownedBefore,ownedAfter});mesh.onBeforeShadow=ownedBefore;mesh.onAfterShadow=ownedAfter;
  };
  const fit=(candidate:Candidate)=>{
    const {light,room}=candidate;room.updateWorldMatrix(true,true);light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);
    const box=new three.Box3().setFromObject(room),size=box.getSize(new three.Vector3());
    if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return false;
    const position=light.getWorldPosition(new three.Vector3()),target=light.target.getWorldPosition(new three.Vector3());
    if(position.distanceToSquared(target)<1e-8)return false;
    // Bound a local region, not the entire exhibition. Large rooms keep a representative
    // target/room-anchored pass instead of disabling all exhibition shadows.
    if(Math.max(size.x,size.y,size.z)>20){const anchor=box.containsPoint(target)?target:box.getCenter(new three.Vector3());box.intersect(new three.Box3(anchor.clone().addScalar(-10),anchor.clone().addScalar(10)));}
    const view=new three.Matrix4().lookAt(position,target,light.shadow.camera.up);view.setPosition(position);view.invert();
    const local=new three.Box3();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])local.expandByPoint(new three.Vector3(x,y,z).applyMatrix4(view));
    // Directional illumination is independent of the light object's distance. Move
    // only its depth-camera eye backwards when the capture straddles that position.
    const shift=light instanceof three.DirectionalLight?Math.max(0,local.max.z+.15):0;
    const near=Math.max(.05,-local.max.z-.1+shift),far=-local.min.z+.1+shift;
    if(!Number.isFinite(far)||far<=near||far>128)return false;
    const camera=light.shadow.camera;camera.near=near;camera.far=far;
    if(camera instanceof three.OrthographicCamera){camera.left=local.min.x-.1;camera.right=local.max.x+.1;camera.bottom=local.min.y-.1;camera.top=local.max.y+.1;}
    camera.updateProjectionMatrix();
    if(light instanceof three.DirectionalLight){
      let pose=poses.get(light);
      if(!pose){
        const original=light.shadow.updateMatrices,proxy=Object.create(light) as THREE.DirectionalLight;
        proxy.matrixWorld=new three.Matrix4();pose={original,proxy};poses.set(light,pose);
        // r186 LightShadow.updateMatrices reads matrixWorld and target only. The
        // proxy remains outside the scene and never changes illumination or aim.
        light.shadow.updateMatrices=()=>original.call(light.shadow,proxy);
      }
      pose.proxy.matrixWorld.copy(light.matrixWorld).setPosition(position.clone().addScaledVector(target.clone().sub(position).normalize(),-shift));
      pose.proxy.target=light.target;
    }
    capture=box;return true;
  };
  const flush=()=>{
    afterRender();
    if(disposed||!dirty)return;dirty=false;
    if(disabled){emit(disabled);return;}
    restoreFlags();if(selected)selected.light.castShadow=false;
    const previous=selected;selected=candidates.find(candidate=>candidate.light.intensity>0&&fit(candidate));
    if(previous&&previous.light!==selected?.light)releaseMap(previous.light);
    if(!selected){renderer.shadowMap.enabled=false;emit('unavailable');return;}
    const meshes:THREE.Mesh[]=[];let triangles=0;
    selected.room.traverseVisible(node=>{
      if(!(node instanceof three.Mesh)||!capture?.intersectsBox(new three.Box3().setFromObject(node)))return;
      const materials=Array.isArray(node.material)?node.material:[node.material];
      // Transparent editor shells and annotation overlays must not become opaque blockers.
      if(materials.some(material=>material.transparent||!material.depthTest))return;
      meshes.push(node);triangles+=(node.geometry.index?.count??node.geometry.getAttribute('position')?.count??0)/3;
    });
    if(meshes.length>64||triangles>100000){releaseMap(selected.light);renderer.shadowMap.enabled=false;emit('unavailable');return;}
    for(const mesh of meshes){flags.set(mesh,{cast:mesh.castShadow,receive:mesh.receiveShadow});mesh.castShadow=true;mesh.receiveShadow=true;installPlanarDepth(mesh);}
    const shadow=selected.light.shadow;shadow.mapSize.set(512,512);shadow.bias=-.0001;
    shadow.normalBias=shadow.camera instanceof three.OrthographicCamera
      ?directionalNormalBias(shadow.camera.right-shadow.camera.left,shadow.camera.top-shadow.camera.bottom,shadow.radius):.01;
    shadow.autoUpdate=false;shadow.needsUpdate=true;
    selected.light.castShadow=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=three.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
    updates++;emit('bounded',meshes.length,triangles);
  };
  // Source lights belong to this scene and are not shared outside this renderer lifetime.
  const dispose=()=>{if(disposed)return;disposed=true;restoreFlags();for(const light of new Set(candidates.map(candidate=>candidate.light)))releaseMap(light);Object.assign(renderer.shadowMap,original);};
  return {flush,afterRender,invalidate:()=>{if(!disposed)dirty=true;},dispose};
}
