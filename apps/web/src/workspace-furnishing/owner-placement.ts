// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings,type WorkspaceFrameAttachment,type WorkspaceOpeningAttachment,type StudioBench} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import type {DeviceBudget} from '../viewer/loading';
import {AssetPeakBudget} from '../viewer/loading';
import {loadWorkspaceFurnishingModel,type WorkspaceModelSource} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {artworkFrameMatrix,fitArtworkFrameGeometry} from './frame-pose';
import {qualifiedFrameTargetFit,qualifiedModularPortalTarget,qualifiedRectangularPortalTarget,workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';
import {artworkFrameFit,artworkFrameModel,portalFinishModel} from '@exhibitos/studio-contract';
import {biasPairedPortalWalls,fitModularPortal,fitRectangularPortal} from './portal-pose';

/** Validate the loaded original in model coordinates, before applying the room pose. */
function backedBenchFits(three:typeof Three,model:Three.Object3D,bounds:Three.Box3,seat:StudioBench['dimensions']){
 const tolerance=.02, halfWidth=seat.width/2, halfDepth=seat.depth/2;
 // The authored collider supplies the allowed width, depth and back height.
 if(bounds.isEmpty()||Math.abs(bounds.min.x+halfWidth)>tolerance||Math.abs(bounds.max.x-halfWidth)>tolerance||
    bounds.min.z < -halfDepth-tolerance||bounds.max.z > halfDepth+tolerance||
    Math.abs(bounds.min.y)>tolerance||bounds.max.y<seat.height+.10||bounds.max.y>seat.height+.40+tolerance)return false;
 const down=new three.Vector3(0,-1,0);
 const ray=new three.Raycaster(new three.Vector3(),down,0,bounds.max.y+1);
 const surfaceAt=(x:number,z:number)=>{
  ray.ray.origin.set(x,bounds.max.y+.05,z);
  return ray.intersectObject(model,true)[0]?.point.y;
 };
 // Sample the seat at its authored center and at two front points clear of the rear rail.
 const seatHeightAt=(x:number,z:number)=>Math.abs((surfaceAt(x,z)??Infinity)-seat.height)<=tolerance;
 const rearHeight=surfaceAt(0,.4*seat.depth);
 return seatHeightAt(0,0)&&seatHeightAt(-seat.width/4,-seat.depth/6)&&seatHeightAt(seat.width/4,-seat.depth/6)
  &&rearHeight!==undefined&&Math.abs(rearHeight-bounds.max.y)<=tolerance;
}

/** Use one scope for the scene and enforce before every render. The default
 * source is owner-only; a supplied publication source must recheck authority. */
export async function mountOwnerWorkspacePlacement(options:{three:typeof Three;renderer:Three.WebGLRenderer;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};scope:OwnerPreviewBudget;roomId:string;placementId:string;frameAttachment?:WorkspaceFrameAttachment;openingAttachment?:WorkspaceOpeningAttachment;room:Three.Object3D;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;ledger:AssetPeakBudget;onRevoked:(error:unknown)=>void;onVisibilityChange?:()=>void;source?:WorkspaceModelSource;sceneManagedAuthority?:boolean;seatDimensions?:StudioBench["dimensions"] & {kind?:StudioBench["kind"]}}){
 const {candidate,three,room,signal}=options;
 if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined,placement=extension?.placements.find(p=>p.id===options.placementId&&p.roomId===options.roomId),attachment=options.frameAttachment,openingAttachment=options.openingAttachment,descriptor=extension?.furnishings.find(f=>f.id===(openingAttachment?.furnishingId??attachment?.furnishingId??placement?.furnishingId)&&f.version===(openingAttachment?.furnishingVersion??attachment?.furnishingVersion??placement?.furnishingVersion));
 if((!placement&&!attachment&&!openingAttachment)||!descriptor||attachment&&!extension?.frameAttachments?.some(a=>a.placementId===attachment.placementId&&a.furnishingId===attachment.furnishingId)||openingAttachment&&!extension?.openingAttachments?.some(a=>a.openingId===openingAttachment.openingId&&a.furnishingId===openingAttachment.furnishingId))throw Error('WORKSPACE_PLACEMENT_INVALID');
 const rights=descriptor.rights as {permissions?:{display?:unknown};expiresAt?:unknown}|null,expires=rights?.expiresAt===undefined?Infinity:typeof rights.expiresAt==='string'?Date.parse(rights.expiresAt):NaN;
 if(rights?.permissions?.display!==true||Number.isNaN(expires)||Date.now()>=expires)throw Error('WORKSPACE_MODEL_AUTHORITY');
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const pose=placement&&structuredClone(placement);let source:WorkspaceModelSource,loaded:Awaited<ReturnType<typeof loadWorkspaceFurnishingModel>>;
 try{source=options.source??ownerWorkspaceModelSource(options.scope,descriptor,controller.signal);loaded=await loadWorkspaceFurnishingModel(three,options.renderer,descriptor.model,source,controller.signal,options.unavailable,options.budget,options.ledger);}catch(error){signal.removeEventListener('abort',abort);controller.abort();throw error;}
 let stopped=false,checking=false,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined,release:(()=>void)|undefined,releaseWallBias:(()=>void)|undefined;
 const dispose=()=>{if(stopped)return;stopped=true;controller.abort();if(timer)clearInterval(timer);if(expiryTimer)clearTimeout(expiryTimer);signal.removeEventListener('abort',abort);signal.removeEventListener('abort',onAbort);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',enforce);loaded.object.visible=false;releaseWallBias?.();loaded.dispose();release?.();};
 const changed=()=>{try{options.onVisibilityChange?.();}catch{/* Rendering callbacks cannot grant authority. */}};
 const fail=(error:unknown)=>{if(stopped)return;try{dispose();}catch{/* Failed resource cleanup retains the scene and byte holds. */}changed();try{options.onRevoked(error);}catch{/* Consumer notification cannot restore visibility. */}};
 const enforce=()=>{if(stopped)return false;try{if(controller.signal.aborted||options.unavailable()||Date.now()>=expires){fail(Error('WORKSPACE_MODEL_AUTHORITY'));return false;}return true;}catch(error){fail(error);return false;}};
 const onAbort=()=>fail(signal.reason);
 const scheduleExpiry=()=>{if(!Number.isFinite(expires))return;expiryTimer=setTimeout(()=>{if(enforce())scheduleExpiry();},Math.min(2147483647,Math.max(0,expires-Date.now())));};
 try{
  const seatDimensions=options.seatDimensions;
  let seatFootprintMatches=false;
  if(seatDimensions){
   const bounds=new three.Box3().setFromObject(loaded.object,true);
   const halfWidth=seatDimensions.width/2,halfDepth=seatDimensions.depth/2,tolerance=.02;
   if(seatDimensions.kind==='backed'){
    seatFootprintMatches=backedBenchFits(three,loaded.object,bounds,seatDimensions);
    if(!seatFootprintMatches)throw Error('WORKSPACE_BACKED_BENCH_FIT');
   }else{
    seatFootprintMatches=!bounds.isEmpty()&&Math.abs(bounds.min.x+halfWidth)<=tolerance&&Math.abs(bounds.max.x-halfWidth)<=tolerance
     &&Math.abs(bounds.min.z+halfDepth)<=tolerance&&Math.abs(bounds.max.z-halfDepth)<=tolerance
     &&Math.abs(bounds.min.y)<=tolerance&&Math.abs(bounds.max.y-seatDimensions.height)<=tolerance;
   }
  }
  controller.signal.throwIfAborted();release=options.scope.reserve(loaded.draws,loaded.triangles);if(!enforce())throw Error('WORKSPACE_MODEL_AUTHORITY');
  if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
  if(openingAttachment){
   const doc=candidate as unknown as Exhibition,opening=doc.openings.find(o=>o.id.toLowerCase()===openingAttachment.openingId.toLowerCase()),wall=doc.surfaces.find(s=>s.id.toLowerCase()===opening?.surfaceId.toLowerCase()&&s.roomId.toLowerCase()===options.roomId.toLowerCase());if(!opening||!wall)throw Error('WORKSPACE_PLACEMENT_INVALID');
   const measured=workspaceFitGeometry(descriptor);
   const rectangular=measured?.profile==='rectangular-portal-v1'?qualifiedRectangularPortalTarget(measured,doc,opening.id):undefined;
   const modular=measured?.profile==='modular-portal-v1'?qualifiedModularPortalTarget(measured,doc,opening.id):undefined;
   if(measured?.profile==='rectangular-portal-v1'){
    if(!rectangular)throw Error('WORKSPACE_PLACEMENT_INVALID');
    fitRectangularPortal(three,loaded.object,measured,rectangular);
    if(opening.connectsToOpeningId!==undefined){
     const mate=doc.openings.find(other=>other.id.toLowerCase()===opening.connectsToOpeningId!.toLowerCase());
     if(!mate)throw Error('WORKSPACE_PLACEMENT_INVALID');
     releaseWallBias=biasPairedPortalWalls(three,room,new Set([wall.id.toLowerCase(),mate.surfaceId.toLowerCase()]));
    }
   }
   if(measured?.profile==='modular-portal-v1'){
    if(!modular)throw Error('WORKSPACE_PLACEMENT_INVALID');
    fitModularPortal(three,loaded.object,measured,modular);
    if(opening.connectsToOpeningId!==undefined){
     const mate=doc.openings.find(other=>other.id.toLowerCase()===opening.connectsToOpeningId!.toLowerCase());
     if(!mate)throw Error('WORKSPACE_PLACEMENT_INVALID');
     releaseWallBias=biasPairedPortalWalls(three,room,new Set([wall.id.toLowerCase(),mate.surfaceId.toLowerCase()]));
    }
   }
   const height=rectangular?.height??modular?.height??(measured?.profile==='continuous-portal-v1'?measured.openingHeight:portalFinishModel(descriptor.model.sha256,descriptor.model.bytes)?.height);
   if(height===undefined)throw Error('WORKSPACE_PLACEMENT_INVALID');
   const p=wall.transform.position,q=wall.transform.rotation,wallMatrix=new three.Matrix4().compose(new three.Vector3(...p),new three.Quaternion(...q),new three.Vector3(1,1,1));
   loaded.object.matrix.copy(wallMatrix.multiply(new three.Matrix4().makeTranslation(opening.offset[0],opening.offset[1]-height/2,0)));loaded.object.matrixAutoUpdate=false;
  }else if(attachment){
   const doc=candidate as unknown as Exhibition,target=doc.placements.find(p=>p.id===attachment.placementId&&p.roomId===options.roomId),art=doc.artworks.find(a=>a.revisionId===attachment.artworkRevisionId);if(!target||!art)throw Error('WORKSPACE_PLACEMENT_INVALID');
   const measured=workspaceFitGeometry(descriptor),ring=measured?.profile==='straight-ring-v1'?measured:undefined;
   const model=artworkFrameModel(descriptor.model.sha256,descriptor.model.bytes);
   const fit=ring?qualifiedFrameTargetFit(ring,art.dimensions.width,art.dimensions.height):model&&artworkFrameFit(model,art.dimensions.width,art.dimensions.height);
   const imagePlaneZ=ring?.imagePlaneZ??model?.imagePlaneZ;
   if(!fit||imagePlaneZ===undefined)throw Error('WORKSPACE_PLACEMENT_INVALID');
   fitArtworkFrameGeometry(three,loaded.object,fit);
   loaded.object.matrix.copy(artworkFrameMatrix(three,target.transform,art.transform,imagePlaneZ));loaded.object.matrixAutoUpdate=false;
  }else if(pose){loaded.object.position.set(...pose.position);loaded.object.rotation.set(0,pose.yaw,0);loaded.object.scale.setScalar(pose.scale);}
  room.add(loaded.object);if(!enforce())throw Error('WORKSPACE_MODEL_AUTHORITY');
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();if(stopped)throw Error('WORKSPACE_MODEL_AUTHORITY');if(!options.sceneManagedAuthority){if(typeof document!=='undefined')document.addEventListener('visibilitychange',enforce);scheduleExpiry();}
  if(!options.sceneManagedAuthority)timer=setInterval(()=>{if(!enforce()||checking)return;checking=true;loaded.object.visible=false;changed();void Promise.resolve().then(()=>source.check()).then(()=>{if(enforce()){loaded.object.visible=true;changed();}}).catch(fail).finally(()=>{checking=false;});},5000);
  return {object:loaded.object,dispose,enforce,seatFootprintMatches};
 }catch(error){try{dispose();}catch{/* Retain the reservation if cleanup is uncertain. */}throw error;}
}
