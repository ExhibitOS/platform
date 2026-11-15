// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';
import {selectShadowDependencies,shadowReceiverRegions} from './shadow-interest';
import type {AssetPeakBudget} from './loading';

// Installed r186 PCF uses one RGBA8 target and one uint32 depth texture, no mipmaps.
export const SHADOW_RESERVE_BYTES = 512 * 512 * 8;
/** r186 PCF: outer Vogel tap sqrt(4.5/5)*radius plus the hardware tap's
 * diagonal footprint. Express the receiver offset in fitted world units. */
export function directionalNormalBias(width:number,height:number,radius:number){
  return Math.max(.01,Math.max(width,height)/512*(Math.sqrt(.9)*radius+Math.SQRT2));
}
const supportMaterialHooks=new WeakMap<THREE.Material,THREE.Material['onBeforeCompile']>();
/** Only this pass's current hook preserves the source geometry. Never trust a
 * material marker or another caller's shader with the same name. */
export const hasSupportContactMaterialHook=(material:THREE.Material)=>
  supportMaterialHooks.get(material)===material.onBeforeCompile;
export type ShadowCandidate = {light: THREE.DirectionalLight | THREE.SpotLight; room: THREE.Object3D;authoredCastShadow?:boolean;sourceLightId?:string;targetPlacementId?:string};
export type ShadowSourceReport = {sourceLightId?:string;targetPlacementId?:string;casters:number;triangles:number;depthDraws:number;targetCasters:number;targetTriangles:number;omittedTargetCasters:number};
export type ShadowReport = {mode:'bounded'|'compact'|'budget'|'unavailable';mapSize:number;casters:number;triangles:number;updates:number;omittedCasters:number;sourceLightId?:string;targetPlacementId?:string;targetCasters?:number;targetTriangles?:number;omittedTargetCasters?:number;mapCount?:number;mapBytes?:number;requestedSources?:number;deferredSources?:number;sources?:ShadowSourceReport[]};

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

/** Stable authored sources and padded camera-position captures. Navigation
 * room labels never change lighting variants, receiver ownership or map identity.
 * No point-light cube maps or new lights; depth work stays globally bounded. */
export function installBoundedShadows(three:typeof THREE,renderer:THREE.WebGLRenderer,
  candidates:ShadowCandidate[],compact:boolean,availableBytes:number,report:(value:ShadowReport)=>void,worldBounds?:THREE.Box3,maxDepthDraws=Infinity) {
  const fixedWorld=worldBounds&&!worldBounds.isEmpty()&&[...worldBounds.min.toArray(),...worldBounds.max.toArray()].every(Number.isFinite)?worldBounds.clone():undefined;
  let dirty=true,disposed=false,updates=0,selected:ShadowCandidate|undefined,capture:THREE.Box3|undefined;
  type Plan={candidate:ShadowCandidate;capture:THREE.Box3};
  let plans:Plan[]=[],requestedSources=0,deferredSources=0,sourceReports:ShadowSourceReport[]=[];
  const anchors=new Map<ShadowCandidate['light'],THREE.Vector3>();
  let mapCapacity=Math.max(0,Math.min(Math.floor(availableBytes/SHADOW_RESERVE_BYTES),Math.floor(maxDepthDraws)));
  let view:THREE.Camera|undefined,captureAnchor:THREE.Vector3|undefined,viewRotation:THREE.Quaternion|undefined,captureProjection:THREE.Matrix4|undefined,omittedLast=0;
  let receiverBounds:THREE.Box3[]=[],receiverVersion=0;
  const dependencyCaches=new Map<ShadowCandidate['light'],{version:number;view:THREE.Matrix4;projection:THREE.Matrix4;light:THREE.Matrix4;lightProjection:THREE.Matrix4;regions:THREE.Box3[]}>();
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
  let targetCasters=0,targetTriangles=0,omittedTargetCasters=0;
  const emit=(mode:ShadowReport['mode'],casters=0,triangles=0,omittedCasters=0)=>report({mode,mapSize:mode==='bounded'?512:0,casters,triangles,updates,omittedCasters,...(selected?.sourceLightId?{sourceLightId:selected.sourceLightId}:{}),...(selected?.authoredCastShadow&&selected.targetPlacementId?{targetPlacementId:selected.targetPlacementId,targetCasters,targetTriangles,omittedTargetCasters}:{}),...(requestedSources>1?{mapCount:mode==='bounded'?plans.length:0,mapBytes:mode==='bounded'?plans.length*SHADOW_RESERVE_BYTES:0,requestedSources,deferredSources,sources:sourceReports}:{})});
  const releaseMap=(light:ShadowCandidate['light'])=>{light.castShadow=false;light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;if(light instanceof three.DirectionalLight){const pose=poses.get(light);if(pose){light.shadow.updateMatrices=pose.original;poses.delete(light);}}};
  const disabled=compact?'compact':mapCapacity<1?'budget':undefined;
  const restoreFlags=()=>{
    afterRender();
    for(const [mesh,old]of hooks){if(mesh.onBeforeShadow===old.ownedBefore)mesh.onBeforeShadow=old.before;if(mesh.onAfterShadow===old.ownedAfter)mesh.onAfterShadow=old.after;}hooks.clear();
    for(const [mesh,old]of flags){mesh.castShadow=old.cast;mesh.receiveShadow=old.receive;}flags.clear();
  };
  const installPlanarDepth=(mesh:THREE.Mesh)=>{
    const material=mesh.material;
    if(Array.isArray(material)||material.shadowSide!==null||material instanceof three.ShaderMaterial||
      material.onBeforeCompile!==three.Material.prototype.onBeforeCompile&&!hasSupportContactMaterialHook(material)||
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
  let priorLight:ShadowCandidate['light']|undefined,priorAnchor:THREE.Vector3|undefined;
  const priority=(mesh:THREE.Mesh)=>{
    let artwork:unknown;
    for(let node:THREE.Object3D|null=mesh;node;node=node.parent){
      if(node.userData.exhibitosShadowArchitecture===true||node.userData.catalogImplicitFloor===true)return 0;
      if(node.userData.viewerArtworkType)artwork=node.userData.viewerArtworkType;
    }
    return artwork==='sculpture'?1:artwork===undefined?2:3;
  };
  const fit=(candidate:ShadowCandidate)=>{
    const {light}=candidate;light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);
    const box=fixedWorld?.clone()??new three.Box3();if(!fixedWorld)for(const room of sourceRooms){room.updateWorldMatrix(true,true);box.expandByObject(room);}
    const size=box.getSize(new three.Vector3());
    if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return false;
    const position=light.getWorldPosition(new three.Vector3()),target=light.target.getWorldPosition(new three.Vector3());
    if(position.distanceToSquared(target)<1e-8)return false;
    // Clip to a near-field capture, including occluders behind the camera. A
    // six-metre inner coverage prevents refitting for tiny movement/room labels.
    const current=view?.getWorldPosition(new three.Vector3());
    const anchor=current&&priorLight===light&&priorAnchor&&current.distanceToSquared(priorAnchor)<=36?priorAnchor.clone():current??(box.containsPoint(target)?target:box.getCenter(new three.Vector3()));
    if(!fixedWorld&&(view||Math.max(size.x,size.y,size.z)>20))box.intersect(new three.Box3(anchor.clone().addScalar(-10),anchor.clone().addScalar(10)));
    if(box.isEmpty())return false;
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
    captureAnchor=view&&!fixedWorld?anchor:undefined;viewRotation=view?.getWorldQuaternion(new three.Quaternion());captureProjection=view?.projectionMatrix.clone();
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
    targetCasters=0;targetTriangles=0;omittedTargetCasters=0;
    if(disabled){emit(disabled);return;}
    const previous=plans;
    // Explicit preferences are stable document inputs, never pass-owned Three flags.
    const authored=candidates.filter(c=>c.authoredCastShadow===true);
    requestedSources=authored.length;sourceReports=[];
    const ordered=authored.length?authored:[...candidates.filter(c=>c.light instanceof three.DirectionalLight),...candidates.filter(c=>c.light instanceof three.SpotLight)];
    const next:Plan[]=[],seenLights=new Set<ShadowCandidate['light']>();
    for(const candidate of ordered){
      if(candidate.light.intensity<=0||seenLights.has(candidate.light))continue;
      if(next.length>=(authored.length?mapCapacity:1))break;
      priorLight=candidate.light;priorAnchor=anchors.get(candidate.light)?.clone();
      if(!fit(candidate)||!capture)continue;
      seenLights.add(candidate.light);next.push({candidate,capture:capture.clone()});
      if(captureAnchor)anchors.set(candidate.light,captureAnchor.clone());
    }
    plans=next;selected=plans[0]?.candidate;
    deferredSources=authored.length?authored.filter(c=>c.light.intensity>0&&!seenLights.has(c.light)).length:0;
    for(const old of previous)if(!seenLights.has(old.candidate.light)){releaseMap(old.candidate.light);anchors.delete(old.candidate.light);dependencyCaches.delete(old.candidate.light);}
    capture=plans.length?plans.reduce((box,plan)=>box.union(plan.capture),new three.Box3()):undefined;
    captureAnchor=selected?anchors.get(selected.light)?.clone():undefined;
    if(!selected){captureAnchor=view?.getWorldPosition(new three.Vector3());viewRotation=view?.getWorldQuaternion(new three.Quaternion());captureProjection=view?.projectionMatrix.clone();restoreFlags();renderer.shadowMap.enabled=false;emit('unavailable');return;}
    const targetId=selected.authoredCastShadow?selected.targetPlacementId:undefined;
    const targetIds=new Set(plans.flatMap(({candidate})=>candidate.authoredCastShadow&&candidate.targetPlacementId?[candidate.targetPlacementId.toLowerCase()]:[]));
    const matchesTarget=(mesh:THREE.Mesh,id:string)=>{
      for(let node:THREE.Object3D|null=mesh;node;node=node.parent)if(typeof node.userData.placementId==='string'&&node.userData.placementId.toLowerCase()===id.toLowerCase())return true;
      return false;
    };
    const isTarget=(mesh:THREE.Mesh)=>[...targetIds].some(id=>matchesTarget(mesh,id));
    const isPrimaryTarget=(mesh:THREE.Mesh)=>!!targetId&&matchesTarget(mesh,targetId);
    const sourceFrusta=new Map(plans.map(({candidate})=>{
      const shadow=candidate.light.shadow;shadow.updateMatrices(candidate.light);
      return [candidate.light,new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(shadow.camera.projectionMatrix,shadow.camera.matrixWorldInverse))] as const;
    }));
    const frustum=view?new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse)):undefined;
    const position=view?.getWorldPosition(new three.Vector3());
    const seen=new Set<THREE.Mesh>(),rows:{mesh:THREE.Mesh;box:THREE.Box3;cost:number;draws:number;visible:boolean;distance:number}[]=[];
    for(const room of sourceRooms)room.traverseVisible(node=>{
      if(!(node instanceof three.Mesh)||node.userData.exhibitosLightFixture===true||seen.has(node))return;
      seen.add(node);const materials=Array.isArray(node.material)?node.material:[node.material];
      if(materials.some(material=>material.transparent||!material.depthTest))return;
      const groups=Array.isArray(node.material)?node.geometry.groups.filter((group:{materialIndex?:number})=>materials[group.materialIndex??0]?.visible):undefined;
      const draws=groups?.length??Number(materials[0]?.visible===true);
      if(!draws)return;
      const box=new three.Box3().setFromObject(node),instances=node instanceof three.InstancedMesh?(Number.isSafeInteger(node.count)&&node.count>=0?node.count:Infinity):1;
      const count=node.geometry.index?.count??node.geometry.getAttribute('position')?.count??0;
      // Repeated/overlapping material groups can draw geometry more than once.
      // Retain the old full-geometry bound, adding any repeated group work.
      const groupCount=groups?.reduce((sum:number,group:{start:number;count:number})=>sum+Math.max(0,Math.min(count,group.start+group.count)-Math.max(0,group.start)),0)??0;
      const cost=Math.max(count,groupCount)/3*instances;
      rows.push({mesh:node,box,cost,draws,visible:!frustum||frustum.intersectsBox(box),distance:position?box.distanceToPoint(position):0});
    });
    // Bound persistent receiver references. Omitted geometry is still rendered.
    // Camera motion cannot exchange architectural occluders for nearby frames.
    // Stable traversal order resolves equal priority within the same scene.
    if(fixedWorld)rows.sort((a,b)=>Number(isTarget(b.mesh))-Number(isTarget(a.mesh))||priority(a.mesh)-priority(b.mesh));
    else rows.sort((a,b)=>Number(isTarget(b.mesh))-Number(isTarget(a.mesh))||Number(b.visible)-Number(a.visible)||a.distance-b.distance);
    const receivers=rows.slice(0,256),eligible=new Set(receivers.map(row=>row.mesh));
    omittedTargetCasters=rows.slice(256).filter(({mesh,box})=>isPrimaryTarget(mesh)&&capture?.intersectsBox(box)&&mesh.userData.exhibitosPlaque!==true).length;
    receiverBounds=receivers.map(row=>row.box);receiverVersion++;
    for(const mesh of [...flags.keys()])if(!eligible.has(mesh))restoreMesh(mesh);
    for(const {mesh} of receivers){if(!flags.has(mesh))flags.set(mesh,{cast:mesh.castShadow,receive:mesh.receiveShadow});mesh.castShadow=false;mesh.receiveShadow=true;}
    for(const [mesh,h]of hooks){if(mesh.onBeforeShadow===h.ownedBefore)mesh.onBeforeShadow=h.before;if(mesh.onAfterShadow===h.ownedAfter)mesh.onAfterShadow=h.after;}hooks.clear();
    // Small structural occluders first, then visible work; retain relevant
    // offscreen occluders in the capture rather than frustum-only shadowing.
    if(!fixedWorld)receivers.sort((a,b)=>Number(isTarget(b.mesh))-Number(isTarget(a.mesh))||Number(b.cost<=12)-Number(a.cost<=12)||Number(b.visible)-Number(a.visible)||a.distance-b.distance);
    const meshes:THREE.Mesh[]=[];let triangles=0,depthTriangles=0,depthDraws=0,omittedCasters=0;
    for(const {mesh,box,cost,draws} of receivers){
      if(!capture?.intersectsBox(box)||mesh.userData.exhibitosPlaque===true)continue;
      const passes=[...sourceFrusta.values()].filter(frustum=>!mesh.frustumCulled||frustum.intersectsBox(box)).length;
      if(!passes)continue;
      if(!Number.isSafeInteger(cost)||cost<1||meshes.length>=64||triangles+cost>100000||depthTriangles+cost*passes>100000||depthDraws+draws*passes>maxDepthDraws){omittedCasters++;if(isPrimaryTarget(mesh))omittedTargetCasters++;continue;}
      meshes.push(mesh);triangles+=cost;depthTriangles+=cost*passes;depthDraws+=draws*passes;if(isPrimaryTarget(mesh)){targetCasters++;targetTriangles+=cost;}
    }
    omittedLast=omittedCasters;
    if(!meshes.length){for(const plan of plans)releaseMap(plan.candidate.light);renderer.shadowMap.enabled=false;emit('unavailable',0,0,omittedCasters);return;}
    for(const mesh of meshes){mesh.castShadow=true;installPlanarDepth(mesh);}
    for(const {candidate} of plans){
      const shadow=candidate.light.shadow;shadow.mapSize.set(512,512);shadow.bias=-.0001;
      shadow.normalBias=shadow.camera instanceof three.OrthographicCamera
        ?directionalNormalBias(shadow.camera.right-shadow.camera.left,shadow.camera.top-shadow.camera.bottom,shadow.radius):.01;
      shadow.autoUpdate=false;shadow.needsUpdate=true;candidate.light.castShadow=true;
      // This is matrix fitting only. The existing renderer owns actual depth draws.
      shadow.updateMatrices(candidate.light);
      const lightFrustum=sourceFrusta.get(candidate.light)!;
      const visibleCasters=receivers.filter(row=>meshes.includes(row.mesh)&&(!row.mesh.frustumCulled||lightFrustum.intersectsBox(row.box)));
      const targetRows=candidate.targetPlacementId?rows.filter(row=>matchesTarget(row.mesh,candidate.targetPlacementId!)&&capture?.intersectsBox(row.box)&&row.mesh.userData.exhibitosPlaque!==true):[];
      const targetDraws=visibleCasters.filter(row=>targetRows.includes(row));
      sourceReports.push({sourceLightId:candidate.sourceLightId,targetPlacementId:candidate.targetPlacementId,casters:visibleCasters.length,triangles:visibleCasters.reduce((n,row)=>n+row.cost,0),depthDraws:visibleCasters.reduce((n,row)=>n+row.draws,0),targetCasters:targetDraws.length,targetTriangles:targetDraws.reduce((n,row)=>n+row.cost,0),omittedTargetCasters:targetRows.length-targetDraws.length});
    }
    if(targetId){targetCasters=sourceReports[0]!.targetCasters;targetTriangles=sourceReports[0]!.targetTriangles;omittedTargetCasters=sourceReports[0]!.omittedTargetCasters;}
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=three.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
    updates++;emit('bounded',meshes.length,triangles,omittedCasters);
  };
  const dependencies=(rows:readonly {id:string;box:THREE.Box3;distance:number}[],camera:THREE.Camera)=>{
    if(disposed||disabled||!plans.length||!renderer.shadowMap.enabled)return {ids:[] as string[],candidates:0,admitted:0,deferred:0};
    const admitted=new Map<string,number>();
    for(const plan of plans){
      const lightCamera=plan.candidate.light.shadow.camera,old=dependencyCaches.get(plan.candidate.light);
      let cached=old;
      if(!cached||cached.version!==receiverVersion||!cached.view.equals(camera.matrixWorld)||!cached.projection.equals(camera.projectionMatrix)||!cached.light.equals(lightCamera.matrixWorld)||!cached.lightProjection.equals(lightCamera.projectionMatrix)){
        cached={version:receiverVersion,view:camera.matrixWorld.clone(),projection:camera.projectionMatrix.clone(),light:lightCamera.matrixWorld.clone(),lightProjection:lightCamera.projectionMatrix.clone(),regions:shadowReceiverRegions(three,receiverBounds,plan.capture,camera,lightCamera)};
        dependencyCaches.set(plan.candidate.light,cached);
      }
      // Keep the existing TWO offscreen dependencies across the whole pool,
      // rather than multiplying the admission bound by the number of lights.
      for(const row of rows)if(selectShadowDependencies(three,[row],plan.capture,cached.regions,lightCamera).ids.length)admitted.set(row.id,Math.min(admitted.get(row.id)??Infinity,row.distance));
    }
    const ids=[...admitted].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])).slice(0,2).map(([id])=>id);
    return {ids,candidates:admitted.size,admitted:ids.length,deferred:admitted.size-ids.length};
  };
  // Source lights belong to this scene and are not shared outside this renderer lifetime.
  const dispose=()=>{if(disposed)return;disposed=true;restoreFlags();for(const light of new Set(candidates.map(candidate=>candidate.light)))releaseMap(light);Object.assign(renderer.shadowMap,original);};
  const setAvailableBytes=(bytes:number)=>{
    if(disposed)return;
    const capacity=Math.max(0,Math.min(Math.floor(bytes/SHADOW_RESERVE_BYTES),Math.floor(maxDepthDraws)));
    if(capacity===mapCapacity)return;
    mapCapacity=capacity;dirty=true;
    // Release removed GPU targets synchronously, before an owner returns their
    // memory reservation to required display work. No draw is issued here.
    if(plans.length>capacity){
      for(const plan of plans.slice(capacity)){releaseMap(plan.candidate.light);anchors.delete(plan.candidate.light);dependencyCaches.delete(plan.candidate.light);}
      plans=plans.slice(0,capacity);selected=plans[0]?.candidate;
    }
  };
  return {flush,afterRender,dependencies,setAvailableBytes,invalidate:()=>{if(!disposed)dirty=true;},dispose};
}

/** Optional maps borrow only already-unoccupied owner-ledger capacity. The
 * caller verifies required representations/phases are settled, and releases
 * this lease BEFORE new required-display admission. Never reclaim artwork. */
export function leaseOptionalShadowMaps(pass:Pick<ReturnType<typeof installBoundedShadows>,'setAvailableBytes'>,
  requestedSources:number,ledger:Pick<AssetPeakBudget,'total'|'reserve'|'release'>,limit:number){
  const count=Math.max(0,Math.min(requestedSources-1,Math.floor((limit-ledger.total())/SHADOW_RESERVE_BYTES)));
  if(!Number.isSafeInteger(count)||count<1)return undefined;
  const key='viewer:optional-shadow-maps',bytes=count*SHADOW_RESERVE_BYTES;
  // reserve() independently checks current live allocations, including holds.
  ledger.reserve(key,bytes,limit);pass.setAvailableBytes(SHADOW_RESERVE_BYTES+bytes);
  let released=false;
  return Object.assign(()=>{if(released)return;pass.setAvailableBytes(SHADOW_RESERVE_BYTES);ledger.release(key);released=true;},{bytes});
}

export type SupportContact = {
  room:THREE.Group;receiver:THREE.Object3D;
  position:readonly [number,number,number];rotation:readonly [number,number,number,number];
  width:number;height:number;
  /** True rectangular support inside the outer, feathered mask. */
  shape?:{kind:'rectangle';width:number;height:number};
  /** Floor masks also follow the actual visible support, not just the floor. */
  supports?:readonly THREE.Object3D[];
};
const VIEW_CONTACT_LIMIT=8,CONTACT_MATERIAL_LIMIT=16,CONTACT_MATRIX_LIMIT=64;
/** Receiver shading owns bounded material-scoped uniforms for its lifetime.
 * View changes update masks without retiring programs, meshes or textures. */
export function installSupportContactShadows(three:typeof THREE,initialContacts:readonly SupportContact[],
  compact:boolean,report:(value:{activeContacts:number;activeTriangles:number;drawCalls:number;textureBytes:number;uniformBytes:number;materials:number;programBytes:null})=>void){
  // Bound world masks independently of camera ranking. Each physical material
  // still uploads at most eight matrices; no extra shader loops, draws or textures.
  const matrixPool=Array.from({length:CONTACT_MATRIX_LIMIT},()=>new three.Matrix4());
  const makeUniforms=()=>({
    exhibitosContactMatrices:{value:Array.from({length:VIEW_CONTACT_LIMIT},()=>matrixPool[0]!)},
    exhibitosContactCount:{value:0},exhibitosContactOpacity:{value:compact?.18:.14},
  });
  type Uniforms=ReturnType<typeof makeUniforms>;
  type Hook={before:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey'];owned:THREE.Material['onBeforeCompile'];ownedKey:THREE.Material['customProgramCacheKey'];hadMarker:boolean;marker:unknown;uniforms:Uniforms};
  const hooks=new Map<THREE.Material,Hook>();let contacts=initialContacts,disposed=false,active:SupportContact[]=[];
  let lastView:THREE.Matrix4|undefined,lastProjection:THREE.Matrix4|undefined,refreshWorld=true;
  type Row={row:SupportContact;matrix:THREE.Matrix4};
  let membership=new Map<THREE.Material,Row[]>(),receiverBounds=new Map<THREE.Material,THREE.Box3[]>();
  const roomMatrices=new Map<THREE.Group,THREE.Matrix4>();
  const visibility=new Map<SupportContact,boolean>();
  const attachedVisible=(node:THREE.Object3D,room:THREE.Group)=>{
    let attached=false;
    for(let ancestor:THREE.Object3D|null=node;ancestor;ancestor=ancestor.parent){if(!ancestor.visible)return false;if(ancestor===room)attached=true;}
    return attached;
  };
  const eligible=(row:SupportContact)=>attachedVisible(row.receiver,row.room)&&(row.supports??[]).every(node=>
    attachedVisible(node,row.room)&&(!(node instanceof three.Mesh)||(Array.isArray(node.material)?node.material:[node.material]).every(material=>material.visible&&!material.transparent&&material.opacity===1)));
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
              // Only xyz rows transform positions. The otherwise unused w row
              // carries rectangle mode and normalized physical half extents.
              if(contactMatrix[0][3]>0.5){
                vec2 contactInner=vec2(contactMatrix[1][3],contactMatrix[2][3]);
                vec2 outside=max(abs(contactUV)-contactInner,vec2(0.0))/max(vec2(0.001),vec2(1.0)-contactInner);
                support=max(0.0,1.0-length(outside));
              }
              contactStrength=max(contactStrength,support*support);
            }
          }
        }
        outgoingLight*=1.0-contactStrength*exhibitosContactOpacity;
        #include <opaque_fragment>`);
    };
    const ownedKey=()=>baseKey+'|exhibitos-support-contact-v3';
    const hook={before,key,owned,ownedKey,uniforms,hadMarker:Object.hasOwn(material.userData,'exhibitosSupportContact'),marker:material.userData.exhibitosSupportContact};
    hooks.set(material,hook);material.onBeforeCompile=owned;material.customProgramCacheKey=ownedKey;
    material.userData.exhibitosSupportContact=uniforms;supportMaterialHooks.set(material,owned);material.needsUpdate=true;
    return hook;
  };
  const setView=(camera:THREE.Camera)=>{
    if(disposed)return;
    camera.updateWorldMatrix(true,false);
    for(const room of new Set(contacts.map(row=>row.room))){
      room.updateWorldMatrix(true,false);
      if(!roomMatrices.get(room)?.equals(room.matrixWorld))refreshWorld=true;
    }
    for(const row of contacts){const live=eligible(row);if(visibility.get(row)!==live)refreshWorld=true;}
    if(!refreshWorld&&lastView?.equals(camera.matrixWorld)&&lastProjection?.equals(camera.projectionMatrix))return;
    lastView=camera.matrixWorld.clone();lastProjection=camera.projectionMatrix.clone();
    if(refreshWorld){
      refreshWorld=false;membership=new Map();receiverBounds=new Map();roomMatrices.clear();visibility.clear();
      for(const room of new Set(contacts.map(row=>row.room)))roomMatrices.set(room,room.matrixWorld.clone());
      const bounds=new Map<THREE.Object3D,THREE.Box3>();let used=0;
      for(const row of contacts){
        const live=eligible(row);visibility.set(row,live);
        // Track every row's visibility even when the bounded matrix pool is
        // full, so unchanged omitted contacts do not force a rebuild per frame.
        if(used>=CONTACT_MATRIX_LIMIT)continue;
        if(!row.position.every(Number.isFinite)||!row.rotation.every(Number.isFinite)||
          Math.abs(row.rotation.reduce((sum,n)=>sum+n*n,0)-1)>.001||![row.width,row.height].every(n=>n>0&&n<=1.8))continue;
        if(row.shape&&(row.shape.kind!=='rectangle'||![row.shape.width,row.shape.height].every(Number.isFinite)||
          row.shape.width<=0||row.shape.width>=row.width||row.shape.height<=0||row.shape.height>=row.height))continue;
        if(!live)continue;
        row.room.updateWorldMatrix(true,false);
        const matrix=matrixPool[used++]!;
        matrix.multiplyMatrices(row.room.matrixWorld,new three.Matrix4().compose(new three.Vector3().fromArray(row.position),new three.Quaternion().fromArray(row.rotation),new three.Vector3(row.width,row.height,1))).invert();
        // GPU payload only: xyz and normal rows remain the exact inverse pose.
        // Do not invert/applyMatrix4 this packed value on CPU without restoring
        // affine w=[0,0,0,1]. No extra uniform arrays or resident buffers.
        if(row.shape){matrix.elements[3]=1;matrix.elements[7]=row.shape.width/row.width;matrix.elements[11]=row.shape.height/row.height;}
        const selected={row,matrix};
        let box=bounds.get(row.receiver);
        if(!box){row.receiver.updateWorldMatrix(true,true);box=new three.Box3().setFromObject(row.receiver);bounds.set(row.receiver,box);}
        const receiverBox=box;
        row.receiver.traverseVisible(node=>{
          if(!(node instanceof three.Mesh))return;
          for(const material of Array.isArray(node.material)?node.material:[node.material]){
            // Receiver-local admission stays stable when another contact enters
            // the camera view. Visibility only chooses which material is hooked.
            if(!membership.has(material)&&membership.size>=CONTACT_MATRIX_LIMIT)continue;
            const rows=membership.get(material)??[];
            if(rows.length<VIEW_CONTACT_LIMIT&&!rows.includes(selected))rows.push(selected);
            membership.set(material,rows);
            const boxes=receiverBounds.get(material)??[];if(!boxes.includes(receiverBox))boxes.push(receiverBox);receiverBounds.set(material,boxes);
          }
        });
      }
    }
    const frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const visible=new Map([...membership].filter(([material])=>receiverBounds.get(material)?.some(box=>frustum.intersectsBox(box))));
    for(const h of hooks.values())h.uniforms.exhibitosContactCount.value=0;
    const admitted=new Set<SupportContact>();
    for(const [material,rows]of visible){
      if(!hooks.has(material)&&hooks.size>=CONTACT_MATERIAL_LIMIT){
        const inactive=[...hooks].find(([owned])=>!visible.has(owned));if(inactive)retire(...inactive);
      }
      const h=install(material);if(!h)continue;
      rows.forEach((row,index)=>{h.uniforms.exhibitosContactMatrices.value[index]=row.matrix;admitted.add(row.row);});
      h.uniforms.exhibitosContactCount.value=rows.length;
    }
    active=[...admitted];publish();
  };
  const setContacts=(next:readonly SupportContact[])=>{
    if(disposed)return;
    const same=contacts.length===next.length&&contacts.every((row,index)=>{
      const other=next[index]!;
      return row.room===other.room&&row.receiver===other.receiver&&row.width===other.width&&row.height===other.height&&
        row.shape?.kind===other.shape?.kind&&row.shape?.width===other.shape?.width&&row.shape?.height===other.shape?.height&&
        row.supports?.length===other.supports?.length&&(row.supports??[]).every((node,i)=>node===other.supports?.[i])&&
        row.position.every((value,i)=>value===other.position[i])&&row.rotation.every((value,i)=>value===other.rotation[i]);
    });
    if(same)return;
    contacts=next;refreshWorld=true;lastView=undefined;
  };
  const dispose=()=>{if(disposed)return;disposed=true;for(const [material,h]of hooks)retire(material,h);active=[];contacts=[];publish();};
  publish();return {setView,setContacts,dispose};
}
