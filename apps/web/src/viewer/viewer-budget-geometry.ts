// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {surfacePanels,wallFinishesFor,floorFor,furnishingsFor,resolveFurnishing,WORKSPACE_FURNISHING_NAMESPACE,frameImageFootprintForArtwork,frameAttachmentMetricFit,artworkFrameModel,artworkFrameFit,portalFinishModel,benchesFor,spaceLightingFor,resolveViewerBudgetPolicy,freezeCanonical,daylightFor,daylightDirection,type ViewerBudgetGeometryInput,type ViewerBudgetGeometryResult,type ViewerBudgetAssetReference,type ViewerBudgetUsage,type WorkspaceFurnishings,type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {workspaceFitGeometry,qualifiedRectangularPortalTarget,qualifiedModularPortalTarget} from '@exhibitos/spec/workspace-fit-models';
import {isMuseumTrackSpotCatalogId} from '@exhibitos/studio-contract';
import {recordCatalogDecodeRetirement} from '../private-editor/catalog-decode-ownership';
import {installDecor} from '../installation-renderer';
import {installBenches} from '../bench-renderer';
import {installArchitecturalFinishes} from '../architectural-finishes-renderer';
import {hasAuthoredGalleryLighting,installLightDetails} from '../light-details-renderer';
import {installPlaques,plaqueTextureReserve} from '../plaque-renderer';
import {environmentEstimate} from './render-quality';
import {artworkFrameMatrix,fitArtworkFrameGeometry} from '../workspace-furnishing/frame-pose';
import {fitRectangularPortal,fitModularPortal,biasPairedPortalWalls} from '../workspace-furnishing/portal-pose';
import {existingSceneCost,registerTransformControlsSceneCost} from '../workspace-furnishing/scene-cost';
import {createTrackSpotRenderSource} from '../private-editor/track-spot-render-source';
import {applyWallwasherModelPose} from '../private-editor/wallwasher-model-pose';
import {nativeOrdinaryInventory} from '../native-ordinary-scene-variants';
import {centerMetricModel,artifactMetricModel} from './metric-model';
import {containedImageSize} from './flat-image-view';
import {embeddedJpegSize} from './detail-model-admission';
import {selectedExhibitionViewerBudget} from './exhibition-budget';
import {DEVICE_BUDGETS,selectAssetVariant,geometryResidentBytes,modelGeometryResidentBytes,modelDecodeReserve,imageDecodeReserve,textureResidentBytes,workspaceFurnishingModelPreflight,type DeviceBudget} from './loading';
import {installBoundedShadows,sculptureShadowRooms,COMPACT_SHADOW_RESERVE_BYTES,SHADOW_RESERVE_BYTES,type ShadowCandidate,type ShadowReport} from './shadows';
import {loadBudgetGeometry} from './viewer-budget-glb';

const pose=(object:three.Object3D,value:{position:readonly number[];rotation:readonly number[];scale:readonly number[]})=>{object.position.fromArray(value.position);object.quaternion.fromArray(value.rotation);object.scale.fromArray(value.scale);};
function ownedClone(source:three.Object3D){
 const model=source.clone(true),geometries=new Map<three.BufferGeometry,three.BufferGeometry>(),materials=new Map<three.Material,three.Material>();
 model.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points){const original:three.BufferGeometry=node.geometry;let geometry=geometries.get(original);if(!geometry){const copy=original.clone();geometries.set(original,copy);geometry=copy;}node.geometry=geometry;
  const copy=(material:three.Material)=>{let result=materials.get(material);if(!result){result=material.clone();materials.set(material,result);}return result;};node.material=Array.isArray(node.material)?node.material.map(copy):copy(node.material);
 }});return model;
}
function geometryBytesMany(roots:readonly three.Object3D[]){
 const attributes:(three.BufferAttribute|three.InterleavedBufferAttribute)[]=[];
 for(const root of roots)root.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points){const geometry:three.BufferGeometry=node.geometry;attributes.push(...Object.values(geometry.attributes));if(geometry.index)attributes.push(geometry.index);if(node instanceof three.InstancedMesh){attributes.push(node.instanceMatrix);if(node.instanceColor)attributes.push(node.instanceColor);}}});
 return geometryResidentBytes(attributes);
}
const geometryBytes=(root:three.Object3D)=>geometryBytesMany([root]);
function disposeModel(root:three.Object3D){const resources=new Set<{dispose():void}>();root.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points){resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])resources.add(material);}});for(const resource of resources)resource.dispose();}
const token=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'ASSET_UNAVAILABLE';

/** Estimate one Viewer scenario using the same selector as the browser. */
export function selectViewerBudgetEstimateTarget(document: Parameters<typeof selectedExhibitionViewerBudget>[0]) {
  const requestedMode = 'auto';
  const hints = {coarsePointer: false, finePointer: true};
  const {selection, policy, budget} = selectedExhibitionViewerBudget(document, requestedMode, hints);

  return {
    scenario: 'fine-pointer-no-memory-hint-auto-v1',
    requestedMode,
    hints,
    selection,
    policy,
    selectionBudget: {maxTriangles: budget.maxTriangles, maxTextureSize: budget.maxTextureSize},
  } as const;
}

/** Authoritative bytes are supplied by the caller. This CPU-only producer
 * assembles the authored scene with existing renderer builders and selectors.
 * It neither grants asset access nor acquires WebGL, DOM, image decoders or URLs. */
export async function analyzeViewerBudgetGeometry(input:ViewerBudgetGeometryInput):Promise<ViewerBudgetGeometryResult>{
 const {candidate,profile}=input,selected={...DEVICE_BUDGETS[profile==='compact'?'compact':'desktop'],...input.selectionBudget};
 const policy=input.resolvedPolicy??resolveViewerBudgetPolicy(candidate,profile,input.recommendedBaseline);
 if(policy.profile!==profile||policy.policyVersion!==1||policy.accountingVersion!==1||freezeCanonical(policy.admission)!==freezeCanonical(resolveViewerBudgetPolicy(candidate,profile,policy.recommended).admission))throw Error('VIEWER_BUDGET_POLICY_INVALID');
 const budget:DeviceBudget={...selected,maxCacheBytes:policy.admission.residentBytes,maxTransitionBytes:policy.admission.transitionBytes,maxSceneTriangles:policy.admission.displayTriangles};
 const compactQuality=budget.maxTextureSize<=512;
 const scene=new three.Scene(),rooms=new Map<string,three.Group>(),surfaces=new Map<string,three.Group>(),surfaceMaterials=new Map<string,three.MeshStandardMaterial>(),placements=new Map<string,three.Group>();
 const owned:{dispose():void}[]=[],models=new Map<string,Promise<Awaited<ReturnType<typeof loadBudgetGeometry>>>>(),bytes=new Map<string,Promise<Uint8Array>>(),unknown:string[]=[],assumptions:string[]=[];
 const assetCosts:ViewerBudgetUsage['contributors']=[],catalogModels:three.Object3D[]=[];let textureBytes=0,decodePeak=0,catalogResident=0,memoryComplete=true,spatialComplete=true;
 const references=new Map<string,Promise<Uint8Array>>(),chargedDigests=new Set<string>();let analysisBytes=0;
 const maximumAnalysisBytes=256*1024*1024;
 const read=(reference:ViewerBudgetAssetReference)=>{
  const identity=freezeCanonical(reference),digestKey=reference.sha256+':'+reference.bytes;let value=references.get(identity);
  if(!value){
   value=(async()=>{
    if(!chargedDigests.has(digestKey)){if(!Number.isSafeInteger(reference.bytes)||reference.bytes<1||analysisBytes+reference.bytes>maximumAnalysisBytes)throw Error('SCENE_RESOURCE_ANALYSIS_BUDGET');chargedDigests.add(digestKey);analysisBytes+=reference.bytes;}
    // Every distinct logical source still crosses the authoritative callback,
    // even when another authorized source has identical bytes.
    const result=await input.loadVerifiedAsset(reference);
    if(result.byteLength!==reference.bytes)throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(result)))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==reference.sha256)throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
    const cached=bytes.get(digestKey);if(cached)return cached;bytes.set(digestKey,Promise.resolve(result));return result;
   })();references.set(identity,value);
  }return value;
 };
 const glb=async(reference:ViewerBudgetAssetReference,workspace=false)=>{
  const body=await read(reference);
  // Reuse the decoder's independent workspace profile (including its 256
  // rendered-pass guard). Inspect demand before soft admission caps instead
  // of treating an unsupported model as complete under a raised scene policy.
  if(workspace){
   const buffer=new Uint8Array(body).buffer;
   workspaceFurnishingModelPreflight(buffer,body.byteLength,{...budget,maxTriangles:Number.MAX_SAFE_INTEGER,maxTextureSize:Number.MAX_SAFE_INTEGER,maxCacheBytes:Number.MAX_SAFE_INTEGER,maxTransitionBytes:Number.MAX_SAFE_INTEGER});
   // Keep selected-model eligibility separate from requested demand. A model
   // deferred by its real quality/byte limits is counted, never called a fit.
   try{workspaceFurnishingModelPreflight(buffer,body.byteLength,budget);}catch(error){unknown.push('workspace:'+reference.furnishingId+':selected-profile:'+token(error));memoryComplete=false;}
  }
  const key=reference.sha256+':'+reference.bytes;let value=models.get(key);if(!value){value=loadBudgetGeometry(body,reference,Math.max(1,maximumAnalysisBytes-analysisBytes)).then(loaded=>{if(analysisBytes+loaded.geometryBytes*2>maximumAnalysisBytes){loaded.dispose();throw Error('SCENE_RESOURCE_ANALYSIS_BUDGET');}analysisBytes+=loaded.geometryBytes*2;return loaded;});models.set(key,value);}return {body,loaded:await value};
 };
 const contribution=(id:string,label:string,roomId:string,model:three.Object3D)=>{const cost=existingSceneCost(three,model);assetCosts.push({id,label,roomId,usage:{colorDraws:cost.draws,displayTriangles:cost.triangles}});};
 const memory=(body:Uint8Array,workspace=false)=>{
  try{const reserve=modelDecodeReserve(body.byteLength,{...budget,maxCacheBytes:Number.MAX_SAFE_INTEGER},new Uint8Array(body).buffer,undefined,'complete');decodePeak=Math.max(decodePeak,reserve);
   // Geometry is counted from actual constructed buffers below; this difference
   // accounts for the header's texture estimate without adding geometry twice.
   const header=new DataView(body.buffer,body.byteOffset,body.byteLength),length=header.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(body.subarray(20,20+length)));
   const encodedGeometry=modelGeometryResidentBytes(doc,body.byteLength-28-length);
   const extra=Math.max(0,reserve-body.byteLength*5-encodedGeometry)+(workspace?body.byteLength*5:0);textureBytes+=extra;return extra;
  }catch{memoryComplete=false;return 0;}
 };
 try{
  const styled=new Set(wallFinishesFor(candidate).map(row=>row.surfaceId.toLowerCase()));
  for(const room of candidate.rooms){const group=new three.Group();pose(group,room.transform);rooms.set(room.id.toLowerCase(),group);scene.add(group);
   const outline=new three.LineSegments(new three.EdgesGeometry(new three.BoxGeometry(room.dimensions.width,room.dimensions.height,room.dimensions.depth)),new three.LineBasicMaterial());outline.position.y=room.dimensions.height/2;outline.visible=profile==='native';group.add(outline);
   if(floorFor(candidate,{roomId:room.id})){const floor=new three.Mesh(new three.PlaneGeometry(room.dimensions.width,room.dimensions.depth),new three.MeshStandardMaterial({side:three.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.userData.catalogImplicitFloor=true;group.add(floor);}
  }
  for(const surface of candidate.surfaces){const group=new three.Group();pose(group,surface.transform);group.userData.exhibitosShadowArchitecture=true;surfaces.set(surface.id.toLowerCase(),group);rooms.get(surface.roomId.toLowerCase())?.add(group);const material=new three.MeshStandardMaterial({side:three.DoubleSide});surfaceMaterials.set(surface.id.toLowerCase(),material);
   if(!styled.has(surface.id.toLowerCase()))for(const panel of surfacePanels(surface,candidate.openings)){const mesh=new three.Mesh(new three.PlaneGeometry(panel.width,panel.height),material);mesh.position.set(panel.x,panel.y,0);group.add(mesh);}
  }
  const decor=installDecor(three,candidate,rooms);for(const placement of candidate.placements){const group=decor.groups.get(placement.id.toLowerCase()),art=candidate.artworks.find(a=>a.revisionId===placement.artworkRevisionId);if(group&&art)group.userData.viewerArtworkType=art.artworkType;}
  owned.push(installArchitecturalFinishes(three,candidate,surfaces,surfaceMaterials),installBenches(three,candidate,rooms),decor);
  const plaques=installPlaques(three,candidate,rooms,compactQuality,()=>{throw Error('CPU_ANALYSIS_NO_CANVAS');});owned.push(plaques);
  if(plaques.meshes.length){memoryComplete=false;assumptions.push('Plaque geometry is included; canvas texture allocation is not decoded by this CPU analysis.');}
  if(profile==='native'){
   for(const opening of candidate.openings){const line=new three.LineSegments(new three.EdgesGeometry(new three.PlaneGeometry(opening.dimensions.width,opening.dimensions.height)),new three.LineBasicMaterial());line.position.set(opening.offset[0],opening.offset[1],.002);surfaces.get(opening.surfaceId.toLowerCase())?.add(line);}
   const control=new TransformControls(new three.PerspectiveCamera()),helper=control.getHelper(),unregister=registerTransformControlsSceneCost(three,control);scene.add(helper);owned.push({dispose:()=>{unregister();helper.dispose();helper.removeFromParent();}});
  }
  for(const placement of candidate.placements){const group=new three.Group();pose(group,placement.transform);group.userData.placementId=placement.id;const art=candidate.artworks.find(a=>a.revisionId===placement.artworkRevisionId);group.userData.viewerArtworkType=art?.artworkType;placements.set(placement.id.toLowerCase(),group);rooms.get(placement.roomId.toLowerCase())?.add(group);}
  const artworkSources=new Map<string,Promise<three.Object3D>>();
  for(const placement of candidate.placements){const art=candidate.artworks.find(a=>a.revisionId===placement.artworkRevisionId),group=placements.get(placement.id.toLowerCase());if(!art||!group)continue;
   try{let value=artworkSources.get(art.revisionId);if(!value){value=(async()=>{
     const asset=profile==='native'?nativeOrdinaryInventory(art,budget):selectAssetVariant(art,0,budget),reference:ViewerBudgetAssetReference={kind:'artwork',artworkId:art.id,artworkRevision:art.revision,assetId:asset.id,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime};
     let model:three.Object3D;
     if(art.artworkType==='image'){
      const body=await read(reference),v=new DataView(body.buffer,body.byteOffset,body.byteLength);let dimensions:{width:number;height:number}|undefined;
      if(body.length>=24&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a)dimensions={width:v.getUint32(16),height:v.getUint32(20)};else dimensions=embeddedJpegSize(body);
      if(!dimensions||!dimensions.width||!dimensions.height)throw Error('SCENE_RESOURCE_IMAGE_UNSUPPORTED');
      const face=frameImageFootprintForArtwork(candidate,art)??containedImageSize({...art.dimensions,imageWidth:dimensions.width,imageHeight:dimensions.height});
      model=new three.Mesh(new three.PlaneGeometry(face.width,face.height),new three.MeshStandardMaterial({side:three.DoubleSide}));
      const scale=profile==='native'?1:Math.min(1,budget.maxTextureSize/Math.max(dimensions.width,dimensions.height)),w=Math.max(1,Math.round(dimensions.width*scale)),h=Math.max(1,Math.round(dimensions.height*scale));
      textureBytes+=textureResidentBytes(w,h);decodePeak=Math.max(decodePeak,imageDecodeReserve(body.length,dimensions.width,dimensions.height,{maxTextureSize:profile==='native'?Math.max(dimensions.width,dimensions.height):budget.maxTextureSize}));
     }else{if(asset.mime!=='model/gltf-binary')throw Error('SCENE_RESOURCE_GLB_UNSUPPORTED');const {body,loaded}=await glb(reference);model=centerMetricModel(three,ownedClone(loaded.model)).object;memory(body);}
     return artifactMetricModel(three,model,art.transform).object;
    })();artworkSources.set(art.revisionId,value);}
    const model=(await value).clone(true);group.add(model);contribution(placement.id,art.metadata.title,placement.roomId,model);
   }catch(error){unknown.push('artwork:'+placement.id+':'+token(error));memoryComplete=false;spatialComplete=false;}
  }
  const lights=new Map<string,{light:three.Light}>();
  for(const item of candidate.lights){const light=item.type==='spot'?new three.SpotLight(0xffffff,item.intensity,0,(item.beamAngle??.6)/2):item.type==='directional'?new three.DirectionalLight(0xffffff,item.intensity):item.type==='area'?new three.RectAreaLight(0xffffff,item.intensity,item.dimensions!.width,item.dimensions!.height):new three.PointLight(0xffffff,item.intensity);pose(light,item.transform);rooms.get(item.roomId.toLowerCase())?.add(light);lights.set(item.id,{light});
   if(light instanceof three.SpotLight||light instanceof three.DirectionalLight){const target=item.targetPlacementId?placements.get(item.targetPlacementId.toLowerCase()):undefined;if(target)light.target=target;else{const aimed=new three.Object3D();aimed.position.copy(light.position).add(new three.Vector3(0,0,-1).applyQuaternion(light.quaternion));rooms.get(item.roomId.toLowerCase())?.add(aimed);light.target=aimed;}}
  }
  const lightDetails=installLightDetails(three,candidate,rooms,lights,profile==='native');owned.push(lightDetails);
  const trackSources=new Map<string,ReturnType<typeof createTrackSpotRenderSource>>();
  for(const binding of furnishingsFor(candidate)?.bindings??[]){const asset=furnishingsFor(candidate)!.assets.find(a=>a.id===binding.assetId);if(!asset)continue;
   try{const resolved=resolveFurnishing(candidate,binding,asset),reference:ViewerBudgetAssetReference={kind:'furnishing',assetId:asset.id,furnishingVersion:asset.catalogVersion,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime},{body,loaded}=await glb(reference);let model:three.Object3D;
    const joint=asset.catalogId==='museum-track-spot-articulated',articulated='articulated'in resolved?resolved.articulated:undefined,wallwasher='wallwasher'in resolved?resolved.wallwasher:undefined,fixturePose=joint?articulated:wallwasher;
    if(joint&&!articulated)throw Error('WALLWASHER_MODEL_PAIR_INVALID');
    const sharedTrack=(joint||isMuseumTrackSpotCatalogId(asset.catalogId))&&!!fixturePose;
    if(sharedTrack){let source=trackSources.get(asset.sha256);if(!source){const templateModel=ownedClone(loaded.model),decodeBytes=geometryBytes(templateModel)+body.length*4,template={model:templateModel,triangles:existingSceneCost(three,loaded.model).triangles,resident:decodeBytes,dispose:()=>disposeModel(templateModel)};recordCatalogDecodeRetirement(three,templateModel,body);decodePeak=Math.max(decodePeak,decodeBytes);source=createTrackSpotRenderSource(three,template,asset);catalogResident+=source.baseResident;trackSources.set(asset.sha256,source);owned.push(source);}const before=source.sharedResident(),instance=source.instantiate(fixturePose!,Number.MAX_SAFE_INTEGER);catalogResident+=source.sharedResident()-before+instance.resident;owned.push(instance);model=instance.model;
    }else{model=ownedClone(loaded.model);if('wallwasher'in resolved)applyWallwasherModelPose(three,model,asset,resolved.wallwasher);else pose(model,resolved.pose);}
    const parent=new three.Group();pose(parent,resolved.parent);parent.add(model);rooms.get(resolved.roomId.toLowerCase())?.add(parent);model.traverse(node=>{if(node instanceof three.Mesh&&binding.hostKind==='light')node.userData.exhibitosLightFixture=true;});
    catalogModels.push(model);if(!sharedTrack){const before=textureBytes;memory(body);const extra=textureBytes-before;textureBytes=before;catalogResident+=body.length*4+geometryBytes(model)+extra;}contribution('catalogue:'+binding.hostKind+':'+binding.hostId,asset.catalogId,resolved.roomId,model);
   }catch(error){unknown.push('catalogue:'+binding.hostId+':'+token(error));memoryComplete=false;spatialComplete=false;}
  }
  const workspace=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const mountWorkspace=async(descriptor:WorkspaceFurnishingDescriptor,roomId:string,id:string,apply:(model:three.Object3D)=>void)=>{
   const reference:ViewerBudgetAssetReference={kind:'furnishing',furnishingId:descriptor.id,furnishingVersion:descriptor.version,sha256:descriptor.model.sha256,bytes:descriptor.model.bytes,mime:descriptor.model.mime},{body,loaded}=await glb(reference,true),model=ownedClone(loaded.model);apply(model);rooms.get(roomId.toLowerCase())?.add(model);memory(body,true);contribution('workspace:'+id,descriptor.name,roomId,model);
  };
  for(const placement of workspace?.placements??[]){try{const descriptor=workspace!.furnishings.find(f=>f.id===placement.furnishingId&&f.version===placement.furnishingVersion);if(!descriptor)throw Error('WORKSPACE_PLACEMENT_INVALID');await mountWorkspace(descriptor,placement.roomId,placement.id,model=>{model.position.fromArray(placement.position);model.rotation.y=placement.yaw;model.scale.setScalar(placement.scale);const bench=benchesFor(candidate).find(b=>b.workspaceVisual?.placementId===placement.id);if(bench?.workspaceVisual?.modelForward==='positive-z'){const basis=new three.Group();basis.rotation.y=Math.PI;for(const node of [...model.children])basis.add(node);model.add(basis);}});}catch(error){unknown.push('workspace:'+placement.id+':'+token(error));memoryComplete=false;spatialComplete=false;}}
  for(const attachment of workspace?.frameAttachments??[]){try{const descriptor=workspace!.furnishings.find(f=>f.id===attachment.furnishingId&&f.version===attachment.furnishingVersion),target=candidate.placements.find(p=>p.id===attachment.placementId),art=candidate.artworks.find(a=>a.revisionId===attachment.artworkRevisionId);if(!descriptor||!target||!art)throw Error('WORKSPACE_PLACEMENT_INVALID');await mountWorkspace(descriptor,target.roomId,attachment.placementId,model=>{const measured=workspaceFitGeometry(descriptor),ring=measured&&(measured.profile==='straight-ring-v1'||measured.profile==='straight-miter-ring-v1')?measured:undefined,source=artworkFrameModel(descriptor.model.sha256,descriptor.model.bytes),metric=ring?frameAttachmentMetricFit(candidate,attachment,art,ring):undefined,fit=ring?metric:source&&artworkFrameFit(source,art.dimensions.width,art.dimensions.height),z=ring?.imagePlaneZ??source?.imagePlaneZ;if(!fit||z===undefined)throw Error('WORKSPACE_PLACEMENT_INVALID');fitArtworkFrameGeometry(three,model,fit);model.matrix.copy(artworkFrameMatrix(three,target.transform,art.transform,z,metric?.rigidFrame??false));model.matrixAutoUpdate=false;});}catch(error){unknown.push('frame:'+attachment.placementId+':'+token(error));memoryComplete=false;spatialComplete=false;}}
  for(const attachment of workspace?.openingAttachments??[]){try{const descriptor=workspace!.furnishings.find(f=>f.id===attachment.furnishingId&&f.version===attachment.furnishingVersion),opening=candidate.openings.find(o=>o.id===attachment.openingId),wall=candidate.surfaces.find(s=>s.id===opening?.surfaceId);if(!descriptor||!opening||!wall)throw Error('WORKSPACE_PLACEMENT_INVALID');await mountWorkspace(descriptor,wall.roomId,opening.id,model=>{const measured=workspaceFitGeometry(descriptor),rectangular=measured?.profile==='rectangular-portal-v1'?qualifiedRectangularPortalTarget(measured,candidate,opening.id):undefined,modular=measured?.profile==='modular-portal-v1'?qualifiedModularPortalTarget(measured,candidate,opening.id):undefined;if(measured?.profile==='rectangular-portal-v1'){if(!rectangular)throw Error('WORKSPACE_PLACEMENT_INVALID');fitRectangularPortal(three,model,measured,rectangular);}if(measured?.profile==='modular-portal-v1'){if(!modular)throw Error('WORKSPACE_PLACEMENT_INVALID');fitModularPortal(three,model,measured,modular);}if((rectangular||modular)&&opening.connectsToOpeningId){const mate=candidate.openings.find(o=>o.id===opening.connectsToOpeningId);if(!mate)throw Error('WORKSPACE_PLACEMENT_INVALID');owned.push({dispose:biasPairedPortalWalls(three,rooms.get(wall.roomId.toLowerCase())!,new Set([wall.id.toLowerCase(),mate.surfaceId.toLowerCase()]))});}const height=rectangular?.height??modular?.height??(measured?.profile==='continuous-portal-v1'?measured.openingHeight:portalFinishModel(descriptor.model.sha256,descriptor.model.bytes)?.height);if(height===undefined)throw Error('WORKSPACE_PLACEMENT_INVALID');model.matrix.compose(new three.Vector3(...wall.transform.position),new three.Quaternion(...wall.transform.rotation),new three.Vector3(1,1,1)).multiply(new three.Matrix4().makeTranslation(opening.offset[0],opening.offset[1]-height/2,0));model.matrixAutoUpdate=false;});}catch(error){unknown.push('opening:'+attachment.openingId+':'+token(error));memoryComplete=false;spatialComplete=false;}}
  scene.updateMatrixWorld(true);
  const sculptureRooms=sculptureShadowRooms(candidate);
  const compactShadowReserve=sculptureRooms.size?COMPACT_SHADOW_RESERVE_BYTES:0;
  let shadow:ShadowReport|undefined;
  if(spatialComplete){
   const candidates:ShadowCandidate[]=[];for(const item of candidate.lights){const light=lights.get(item.id)!.light,room=rooms.get(item.roomId.toLowerCase());if(room&&(light instanceof three.SpotLight||light instanceof three.DirectionalLight))candidates.push({light,room,authoredCastShadow:item.castsShadow===true,sourceLightId:item.id,targetPlacementId:item.targetPlacementId,sculptureRoom:sculptureRooms.get(item.id)});}
   const hasAuthored=hasAuthoredGalleryLighting(candidate);
   const sun=new three.DirectionalLight(0xffffff,spaceLightingFor(candidate)||hasAuthored?0:3),daylight=daylightFor(candidate);if(daylight){const direction=daylightDirection(daylight);sun.position.fromArray(direction.map(n=>n*100));sun.intensity=daylight.enabled&&direction[1]>0?daylight.intensity:0;}else sun.position.set(20,30,25);scene.add(sun);for(const room of rooms.values())candidates.push({light:sun,room});
   const world=new three.Box3();for(const group of surfaces.values())world.expandByObject(group);const fixed=!world.isEmpty()&&Math.max(...world.getSize(new three.Vector3()).toArray())<=32?world:undefined;
   const renderer={shadowMap:{enabled:false,autoUpdate:true,type:three.PCFShadowMap}} as unknown as three.WebGLRenderer;
   const pass=installBoundedShadows(three,renderer,candidates,compactQuality,compactQuality?compactShadowReserve:2*SHADOW_RESERVE_BYTES,value=>{shadow=value;},fixed,profile==='native'?384:256,{shadowCasterTriangles:Number.MAX_SAFE_INTEGER,shadowDepthTriangles:Number.MAX_SAFE_INTEGER});owned.push(pass);pass.flush();
  }
  const viewDependentShadows=compactQuality?sculptureRooms.size>1:sculptureRooms.size>0;
  const cost=existingSceneCost(three,scene),geometry=geometryBytes(scene),complete=unknown.length===0&&memoryComplete&&!viewDependentShadows&&!(shadow?.omittedCasters||shadow?.deferredSources);
  if(viewDependentShadows)assumptions.push('Shadow depth values sample one source set. Viewer room and camera changes can select other sources with different depth costs.');
  if(catalogResident>4*1024*1024){memoryComplete=false;assumptions.push('Catalogue-other source/node demand exceeds the independent 4 MiB renderer suballocation; inspect fixture contributors before runtime use.');}
  assumptions.push(`Selected per-model allowance ${budget.maxTriangles} triangles / ${budget.maxTextureSize}px (${input.selectionBudget?'explicit runtime selection':'profile default'}); no device performance guarantee.`,
   'Whole-exhibition geometry includes hidden authored objects and retained procedural fallbacks; it is not a current-view draw count.',
   'Memory describes an all-selected-assets scenario, not current-view residency or download traffic. Unsupported texture/material allocations remain unknown.',
   'Shadow values describe requested work before the chosen triangle admission caps, using the same source/frustum planner and independent map/caster/depth-draw bounds. Actual Viewer applies the chosen caps and may omit work; omitted/deferred sources prevent a complete claim.',
   'Room scenarios can overlap in one view; their individual success is not an all-view safety guarantee. No GPU time or physical VRAM is measured.',...unknown);
  if(candidate.extensions?.['org.exhibitos.studio/workspace-materials']||candidate.extensions?.['org.exhibitos.studio/floors']||candidate.extensions?.['org.exhibitos.studio/materials']){memoryComplete=false;assumptions.push('Authored floor/surface/environment material allocations require their resource planner; geometry and inspected asset memory are lower bounds.');}
  const usage=(scope:ViewerBudgetUsage['scope'],draws:number,triangles:number,contributors:ViewerBudgetUsage['contributors'],resident:number|null,transition:number|null):ViewerBudgetUsage=>({scope,complete:complete&&memoryComplete,colorDraws:draws,displayTriangles:triangles,shadowCasterTriangles:scope==='wholeExhibition'?shadow?.triangles??null:null,shadowDepthTriangles:scope==='wholeExhibition'?shadow?.depthTriangles??null:null,residentBytes:resident,transitionBytes:transition,contributors,assumptions:[...assumptions]});
  const requestedMapBytes=shadow?.mapBytes??(shadow?.mode==='bounded'?SHADOW_RESERVE_BYTES:0),shadowReserve=compactQuality?compactShadowReserve:Math.max(SHADOW_RESERVE_BYTES,requestedMapBytes);
  const fixedReserve=environmentEstimate(compactQuality?64:128).generationPeakBytes+shadowReserve+plaqueTextureReserve(candidate,compactQuality);
  const resident=geometry-geometryBytesMany(catalogModels)+catalogResident+textureBytes+fixedReserve,wholeExhibition=usage('wholeExhibition',cost.draws,cost.triangles,assetCosts,resident,resident+decodePeak);
  const analyzedSections=[...rooms].map(([roomId,room])=>{const cost=existingSceneCost(three,room);return usage('analyzedSection',cost.draws,cost.triangles,assetCosts.filter(row=>row.roomId?.toLowerCase()===roomId),geometryBytes(room),null);}).sort((a,b)=>(b.colorDraws??0)-(a.colorDraws??0));
  return {accountingVersion:1,profile,wholeExhibition,analyzedSections,assumptions};
 }finally{
  for(const owner of owned.reverse())owner.dispose();
  const resources=new Set<{dispose():void}>();scene.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points){resources.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:[node.material])resources.add(m);if(node instanceof three.InstancedMesh)resources.add(node);}});for(const resource of resources)resource.dispose();for(const value of models.values())try{(await value).dispose();}catch{/* An unsupported source never returned an owned model. */}
 }
}
