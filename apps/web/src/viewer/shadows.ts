// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';

// Installed r186 PCF uses one RGBA8 target and one uint32 depth texture, no mipmaps.
export const SHADOW_RESERVE_BYTES = 512 * 512 * 8;
/** r186 PCF: outer Vogel tap sqrt(4.5/5)*radius plus the hardware tap's
 * diagonal footprint. Express the receiver offset in fitted world units. */
export function directionalNormalBias(width:number,height:number,radius:number){
  return Math.max(.01,Math.max(width,height)/512*(Math.sqrt(.9)*radius+Math.SQRT2));
}
const supportMaterialHooks=new WeakMap<THREE.Material,THREE.Material['onBeforeCompile']>();
type Candidate = {light: THREE.DirectionalLight | THREE.SpotLight; room: THREE.Object3D};
export type ShadowReport = {mode:'bounded'|'compact'|'budget'|'unavailable';mapSize:number;casters:number;triangles:number;updates:number;omittedCasters:number};

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

/** One stable authored source and a padded camera-position capture. Navigation
 * room labels never change lighting variants, receiver ownership or map identity.
 * No point-light cube maps or new lights; depth work stays globally bounded. */
export function installBoundedShadows(three:typeof THREE,renderer:THREE.WebGLRenderer,
  candidates:Candidate[],compact:boolean,availableBytes:number,report:(value:ShadowReport)=>void) {
  let dirty=true,disposed=false,updates=0,selected:Candidate|undefined,capture:THREE.Box3|undefined;
  let view:THREE.Camera|undefined,captureAnchor:THREE.Vector3|undefined,viewRotation:THREE.Quaternion|undefined,captureProjection:THREE.Matrix4|undefined,omittedLast=0;
  const sourceRooms=[...new Set(candidates.map(candidate=>candidate.room))];
  const planarity=new WeakMap<THREE.BufferGeometry,{position:unknown;positionVersion:number;index:unknown;indexVersion:number;result:boolean}>();
  const cachedPlanar=(geometry:THREE.BufferGeometry)=>{
    const position=geometry.getAttribute('position'),index=geometry.index;
    const positionVersion=position instanceof three.InterleavedBufferAttribute?position.data.version:position?.version??-1;
    const indexVersion=index?.version??-1,old=planarity.get(geometry);
    if(old&&old.position===position&&old.positionVersion===positionVersion&&old.index===index&&old.indexVersion===indexVersion)return old.result;
    const result=planarGeometry(three,geometry);planarity.set(geometry,{position,positionVersion,index,indexVersion,result});return result;
  };
  const original={enabled:renderer.shadowMap.enabled,autoUpdate:renderer.shadowMap.autoUpdate,type:renderer.shadowMap.type};
  const flags=new Map<THREE.Mesh,{cast:boolean;receive:boolean}>();
  const hooks=new Map<THREE.Mesh,{before:THREE.Mesh['onBeforeShadow'];after:THREE.Mesh['onAfterShadow'];ownedBefore:THREE.Mesh['onBeforeShadow'];ownedAfter:THREE.Mesh['onAfterShadow']}>();
  const depthSides=new Map<THREE.Material,THREE.Side>();
  const restoreDepth=(material:THREE.Material)=>{const side=depthSides.get(material);if(side!==undefined){material.side=side;depthSides.delete(material);}};
  const afterRender=()=>{for(const [material]of depthSides)restoreDepth(material);};
  const poses=new Map<THREE.DirectionalLight,{original:THREE.DirectionalLight['shadow']['updateMatrices'];proxy:THREE.DirectionalLight}>();
  const emit=(mode:ShadowReport['mode'],casters=0,triangles=0,omittedCasters=0)=>report({mode,mapSize:mode==='bounded'?512:0,casters,triangles,updates,omittedCasters});
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
      material.onBeforeCompile!==three.Material.prototype.onBeforeCompile&&supportMaterialHooks.get(material)!==material.onBeforeCompile||
      mesh instanceof three.SkinnedMesh||mesh instanceof three.InstancedMesh||('isBatchedMesh'in mesh&&mesh.isBatchedMesh)||('isInstancedBufferGeometry'in mesh.geometry&&mesh.geometry.isInstancedBufferGeometry)||
      mesh.customDepthMaterial||mesh.customDistanceMaterial||
      mesh.onBeforeShadow!==three.Object3D.prototype.onBeforeShadow||mesh.onAfterShadow!==three.Object3D.prototype.onAfterShadow||
      Object.values(mesh.geometry.morphAttributes).some(attributes=>attributes.length>0)||
      ('displacementMap'in material&&material.displacementMap)||!cachedPlanar(mesh.geometry))return;
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
    const {light}=candidate;light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);
    const box=new three.Box3();for(const room of sourceRooms){room.updateWorldMatrix(true,true);box.expandByObject(room);}
    const size=box.getSize(new three.Vector3());
    if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return false;
    const position=light.getWorldPosition(new three.Vector3()),target=light.target.getWorldPosition(new three.Vector3());
    if(position.distanceToSquared(target)<1e-8)return false;
    // Clip to a near-field capture, including occluders behind the camera. A
    // six-metre inner coverage prevents refitting for tiny movement/room labels.
    const anchor=view?.getWorldPosition(new three.Vector3())??(box.containsPoint(target)?target:box.getCenter(new three.Vector3()));
    if(view||Math.max(size.x,size.y,size.z)>20)box.intersect(new three.Box3(anchor.clone().addScalar(-10),anchor.clone().addScalar(10)));
    if(box.isEmpty())return false;
    captureAnchor=view?anchor:undefined;viewRotation=view?.getWorldQuaternion(new three.Quaternion());captureProjection=view?.projectionMatrix.clone();
    const lightView=new three.Matrix4().lookAt(position,target,light.shadow.camera.up);lightView.setPosition(position);lightView.invert();
    const local=new three.Box3();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])local.expandByPoint(new three.Vector3(x,y,z).applyMatrix4(lightView));
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
  const restoreMesh=(mesh:THREE.Mesh)=>{
    const h=hooks.get(mesh);if(h){if(mesh.onBeforeShadow===h.ownedBefore)mesh.onBeforeShadow=h.before;if(mesh.onAfterShadow===h.ownedAfter)mesh.onAfterShadow=h.after;hooks.delete(mesh);}
    const old=flags.get(mesh);if(old){mesh.castShadow=old.cast;mesh.receiveShadow=old.receive;flags.delete(mesh);}
  };
  const flush=(camera?:THREE.Camera)=>{
    afterRender();
    if(disposed)return;
    if(camera){
      view=camera;camera.updateWorldMatrix(true,false);
      if(captureAnchor){const position=camera.getWorldPosition(new three.Vector3());
        if(position.distanceToSquared(captureAnchor)>(selected?36:.16))dirty=true;
        if((omittedLast||!selected)&&(viewRotation&&Math.abs(camera.getWorldQuaternion(new three.Quaternion()).dot(viewRotation))<Math.cos(Math.PI/24)||!captureProjection?.equals(camera.projectionMatrix)))dirty=true;
      }
    }
    if(!dirty)return;dirty=false;
    if(disabled){emit(disabled);return;}
    const previous=selected;
    // Keep a positive directional source ahead of spots. Authored values never
    // change; only representative shadow-source policy changes from room-based.
    const ordered=[...candidates.filter(c=>c.light instanceof three.DirectionalLight),...candidates.filter(c=>c.light instanceof three.SpotLight)];
    selected=ordered.find(candidate=>candidate.light.intensity>0&&fit(candidate));
    if(previous&&previous.light!==selected?.light)releaseMap(previous.light);
    if(!selected){captureAnchor=view?.getWorldPosition(new three.Vector3());viewRotation=view?.getWorldQuaternion(new three.Quaternion());captureProjection=view?.projectionMatrix.clone();restoreFlags();renderer.shadowMap.enabled=false;emit('unavailable');return;}
    const frustum=view?new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse)):undefined;
    const position=view?.getWorldPosition(new three.Vector3());
    const seen=new Set<THREE.Mesh>(),rows:{mesh:THREE.Mesh;box:THREE.Box3;cost:number;visible:boolean;distance:number}[]=[];
    for(const room of sourceRooms)room.traverseVisible(node=>{
      if(!(node instanceof three.Mesh)||node.userData.exhibitosLightFixture===true||seen.has(node))return;
      seen.add(node);const materials=Array.isArray(node.material)?node.material:[node.material];
      if(materials.some(material=>material.transparent||!material.depthTest))return;
      const box=new three.Box3().setFromObject(node),instances=node instanceof three.InstancedMesh?(Number.isSafeInteger(node.count)&&node.count>=0?node.count:Infinity):1;
      const cost=(node.geometry.index?.count??node.geometry.getAttribute('position')?.count??0)/3*instances;
      rows.push({mesh:node,box,cost,visible:!frustum||frustum.intersectsBox(box),distance:position?box.distanceToPoint(position):0});
    });
    // Bound persistent receiver references. Omitted geometry is still rendered.
    rows.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance);
    const receivers=rows.slice(0,256),eligible=new Set(receivers.map(row=>row.mesh));
    for(const mesh of [...flags.keys()])if(!eligible.has(mesh))restoreMesh(mesh);
    for(const {mesh} of receivers){if(!flags.has(mesh))flags.set(mesh,{cast:mesh.castShadow,receive:mesh.receiveShadow});mesh.castShadow=false;mesh.receiveShadow=true;}
    for(const [mesh,h]of hooks){if(mesh.onBeforeShadow===h.ownedBefore)mesh.onBeforeShadow=h.before;if(mesh.onAfterShadow===h.ownedAfter)mesh.onAfterShadow=h.after;}hooks.clear();
    // Small structural occluders first, then visible work; retain relevant
    // offscreen occluders in the capture rather than frustum-only shadowing.
    receivers.sort((a,b)=>Number(b.cost<=12)-Number(a.cost<=12)||Number(b.visible)-Number(a.visible)||a.distance-b.distance);
    const meshes:THREE.Mesh[]=[];let triangles=0,omittedCasters=0;
    for(const {mesh,box,cost} of receivers){
      if(!capture?.intersectsBox(box)||mesh.userData.exhibitosPlaque===true)continue;
      if(!Number.isSafeInteger(cost)||cost<1||meshes.length>=64||triangles+cost>100000){omittedCasters++;continue;}
      meshes.push(mesh);triangles+=cost;
    }
    omittedLast=omittedCasters;
    if(!meshes.length){releaseMap(selected.light);renderer.shadowMap.enabled=false;emit('unavailable',0,0,omittedCasters);return;}
    for(const mesh of meshes){mesh.castShadow=true;installPlanarDepth(mesh);}
    const shadow=selected.light.shadow;shadow.mapSize.set(512,512);shadow.bias=-.0001;
    shadow.normalBias=shadow.camera instanceof three.OrthographicCamera
      ?directionalNormalBias(shadow.camera.right-shadow.camera.left,shadow.camera.top-shadow.camera.bottom,shadow.radius):.01;
    shadow.autoUpdate=false;shadow.needsUpdate=true;
    selected.light.castShadow=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=three.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
    updates++;emit('bounded',meshes.length,triangles,omittedCasters);
  };
  // Source lights belong to this scene and are not shared outside this renderer lifetime.
  const dispose=()=>{if(disposed)return;disposed=true;restoreFlags();for(const light of new Set(candidates.map(candidate=>candidate.light)))releaseMap(light);Object.assign(renderer.shadowMap,original);};
  return {flush,afterRender,invalidate:()=>{if(!disposed)dirty=true;},dispose};
}

export type SupportContact = {
  room:THREE.Group;receiver:THREE.Object3D;
  position:readonly [number,number,number];rotation:readonly [number,number,number,number];
  width:number;height:number;
};
const VIEW_CONTACT_LIMIT=8,CONTACT_MATERIAL_LIMIT=16;
/** Receiver shading owns bounded material-scoped uniforms for its lifetime.
 * View changes update masks without retiring programs, meshes or textures. */
export function installSupportContactShadows(three:typeof THREE,initialContacts:readonly SupportContact[],
  compact:boolean,report:(value:{activeContacts:number;activeTriangles:number;drawCalls:number;textureBytes:number;uniformBytes:number;materials:number;programBytes:null})=>void){
  // Share eight owned world matrices; each material has its own reference mask.
  const matrixPool=Array.from({length:VIEW_CONTACT_LIMIT},()=>new three.Matrix4());
  const makeUniforms=()=>({
    exhibitosContactMatrices:{value:Array.from({length:VIEW_CONTACT_LIMIT},()=>matrixPool[0]!)},
    exhibitosContactCount:{value:0},exhibitosContactOpacity:{value:compact?.18:.14},
  });
  type Uniforms=ReturnType<typeof makeUniforms>;
  type Hook={before:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey'];owned:THREE.Material['onBeforeCompile'];ownedKey:THREE.Material['customProgramCacheKey'];hadMarker:boolean;marker:unknown;uniforms:Uniforms};
  const hooks=new Map<THREE.Material,Hook>();let contacts=initialContacts,disposed=false,active:SupportContact[]=[];
  let lastPosition:THREE.Vector3|undefined,lastRotation:THREE.Quaternion|undefined,lastProjection:THREE.Matrix4|undefined;
  const publish=()=>report({activeContacts:active.length,activeTriangles:0,drawCalls:0,textureBytes:0,
    uniformBytes:hooks.size*(VIEW_CONTACT_LIMIT*16*4+8),materials:hooks.size,programBytes:null});
  const retire=(material:THREE.Material,h:Hook)=>{
    h.uniforms.exhibitosContactCount.value=0;
    if(material.onBeforeCompile===h.owned)material.onBeforeCompile=h.before;
    if(material.customProgramCacheKey===h.ownedKey)material.customProgramCacheKey=h.key;
    if(material.userData.exhibitosSupportContact===h.uniforms){
      if(h.hadMarker)material.userData.exhibitosSupportContact=h.marker;else delete material.userData.exhibitosSupportContact;
    }
    if(supportMaterialHooks.get(material)===h.owned)supportMaterialHooks.delete(material);
    // r186 caches uniform references with the material program. Final retirement
    // must clear them, including inactive materials retained by this controller.
    material.needsUpdate=true;material.dispose();hooks.delete(material);
  };
  const install=(material:THREE.Material)=>{
    const prior=hooks.get(material);if(prior)return prior;
    if(hooks.size>=CONTACT_MATERIAL_LIMIT||!(material instanceof three.MeshStandardMaterial)||
      material.onBeforeCompile!==three.Material.prototype.onBeforeCompile||
      material.customProgramCacheKey!==three.Material.prototype.customProgramCacheKey)return;
    const uniforms=makeUniforms(),before=material.onBeforeCompile,key=material.customProgramCacheKey,baseKey=key.call(material);
    const owned:THREE.Material['onBeforeCompile']=(shader,renderer)=>{
      before.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
      shader.vertexShader='varying vec3 vExhibitosContactWorld;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vec4 contactWorld=vec4(transformed,1.0);
        #ifdef USE_BATCHING
          contactWorld=batchingMatrix*contactWorld;
        #endif
        #ifdef USE_INSTANCING
          contactWorld=instanceMatrix*contactWorld;
        #endif
        vExhibitosContactWorld=(modelMatrix*contactWorld).xyz;`);
      shader.fragmentShader=`varying vec3 vExhibitosContactWorld;
        uniform mat4 exhibitosContactMatrices[8];
        uniform int exhibitosContactCount;
        uniform float exhibitosContactOpacity;
      `+shader.fragmentShader.replace('#include <opaque_fragment>',`
        float contactStrength=0.0;
        vec3 contactNormal=inverseTransformDirection(normal,viewMatrix);
        for(int contactIndex=0;contactIndex<8;contactIndex++){
          if(contactIndex<exhibitosContactCount){
            mat4 contactMatrix=exhibitosContactMatrices[contactIndex];
            vec3 contactPoint=(contactMatrix*vec4(vExhibitosContactWorld,1.0)).xyz;
            vec3 planeNormal=normalize(vec3(contactMatrix[0][2],contactMatrix[1][2],contactMatrix[2][2]));
            if(abs(contactPoint.z)<0.008&&dot(contactNormal,planeNormal)>0.5){
              vec2 contactUV=contactPoint.xy*2.0;
              float support=max(0.0,1.0-dot(contactUV,contactUV));
              contactStrength=max(contactStrength,support*support);
            }
          }
        }
        outgoingLight*=1.0-contactStrength*exhibitosContactOpacity;
        #include <opaque_fragment>`);
    };
    const ownedKey=()=>baseKey+'|exhibitos-support-contact-v2';
    const hook={before,key,owned,ownedKey,uniforms,hadMarker:Object.hasOwn(material.userData,'exhibitosSupportContact'),marker:material.userData.exhibitosSupportContact};
    hooks.set(material,hook);material.onBeforeCompile=owned;material.customProgramCacheKey=ownedKey;
    material.userData.exhibitosSupportContact=uniforms;supportMaterialHooks.set(material,owned);material.needsUpdate=true;
    return hook;
  };
  const setView=(camera:THREE.Camera)=>{
    if(disposed)return;
    camera.updateWorldMatrix(true,false);
    const position=camera.getWorldPosition(new three.Vector3()),rotation=camera.getWorldQuaternion(new three.Quaternion());
    if(lastPosition&&position.distanceToSquared(lastPosition)<.16&&lastRotation&&Math.abs(rotation.dot(lastRotation))>Math.cos(Math.PI/72)&&lastProjection?.equals(camera.projectionMatrix))return;
    lastPosition=position;lastRotation=rotation;lastProjection=camera.projectionMatrix.clone();
    const frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    type Row={row:SupportContact;matrix:THREE.Matrix4;score:number};
    const selected:Row[]=[];
    // Stream the existing descriptor array: retain at most eight world masks.
    for(const row of contacts){
      if(!row.position.every(Number.isFinite)||!row.rotation.every(Number.isFinite)||
        Math.abs(row.rotation.reduce((sum,n)=>sum+n*n,0)-1)>.001||![row.width,row.height].every(n=>n>0&&n<=1.8))continue;
      let ancestor:THREE.Object3D|null=row.receiver,attached=false,visible=true;
      while(ancestor){if(!ancestor.visible)visible=false;if(ancestor===row.room)attached=true;ancestor=ancestor.parent;}
      if(!attached||!visible)continue;
      row.room.updateWorldMatrix(true,false);
      const world=new three.Matrix4().multiplyMatrices(row.room.matrixWorld,new three.Matrix4().compose(new three.Vector3().fromArray(row.position),new three.Quaternion().fromArray(row.rotation),new three.Vector3(row.width,row.height,1)));
      const center=new three.Vector3().setFromMatrixPosition(world),distance=center.distanceTo(position);
      if(distance>12)continue;
      const box=new three.Box3().setFromPoints([[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]].map(([x,y])=>new three.Vector3(x,y,0).applyMatrix4(world))).expandByScalar(.05);
      if(!frustum.intersectsBox(box))continue;
      const score=distance-(active.includes(row)?.75:0);
      selected.push({row,matrix:world.invert(),score});selected.sort((a,b)=>a.score-b.score);
      if(selected.length>VIEW_CONTACT_LIMIT)selected.pop();
    }
    selected.forEach((row,index)=>matrixPool[index]!.copy(row.matrix));
    const membership=new Map<THREE.Material,Row[]>();
    for(const row of selected)row.row.receiver.traverseVisible(node=>{
      if(node instanceof three.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material]){
        if(!membership.has(material)&&membership.size>=CONTACT_MATERIAL_LIMIT)continue;
        const rows=membership.get(material)??[];if(!rows.includes(row))rows.push(row);membership.set(material,rows);
      }
    });
    for(const h of hooks.values())h.uniforms.exhibitosContactCount.value=0;
    const admitted=new Set<SupportContact>();
    for(const [material,rows]of membership){
      // Admission is sequential: every missing material may need its own slot.
      if(!hooks.has(material)&&hooks.size>=CONTACT_MATERIAL_LIMIT){
        const inactive=[...hooks].find(([owned])=>!membership.has(owned));if(inactive)retire(...inactive);
      }
      const h=install(material);if(!h)continue;
      rows.forEach((row,index)=>{h.uniforms.exhibitosContactMatrices.value[index]=matrixPool[selected.indexOf(row)]!;admitted.add(row.row);});
      h.uniforms.exhibitosContactCount.value=rows.length;
    }
    active=selected.map(row=>row.row).filter(row=>admitted.has(row));publish();
  };
  const setContacts=(next:readonly SupportContact[])=>{
    if(disposed)return;
    const same=contacts.length===next.length&&contacts.every((row,index)=>{
      const other=next[index]!;
      return row.room===other.room&&row.receiver===other.receiver&&row.width===other.width&&row.height===other.height&&
        row.position.every((value,i)=>value===other.position[i])&&row.rotation.every((value,i)=>value===other.rotation[i]);
    });
    if(same)return;
    contacts=next;active=[];lastPosition=undefined;
  };
  const dispose=()=>{if(disposed)return;disposed=true;for(const [material,h]of hooks)retire(material,h);active=[];contacts=[];publish();};
  publish();return {setView,setContacts,dispose};
}
