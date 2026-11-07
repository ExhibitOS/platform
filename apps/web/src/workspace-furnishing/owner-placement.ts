// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings,type WorkspaceFrameAttachment} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import type {DeviceBudget} from '../viewer/loading';
import {AssetPeakBudget} from '../viewer/loading';
import {loadWorkspaceFurnishingModel,type WorkspaceModelSource} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';
import {artworkFrameMatrix} from './frame-pose';

/** Use one scope for the scene and enforce before every render. The default
 * source is owner-only; a supplied publication source must recheck authority. */
export async function mountOwnerWorkspacePlacement(options:{three:typeof Three;renderer:Three.WebGLRenderer;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};scope:OwnerPreviewBudget;roomId:string;placementId:string;frameAttachment?:WorkspaceFrameAttachment;room:Three.Object3D;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;ledger:AssetPeakBudget;onRevoked:(error:unknown)=>void;onVisibilityChange?:()=>void;source?:WorkspaceModelSource;sceneManagedAuthority?:boolean}){
 const {candidate,three,room,signal}=options;
 if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined,placement=extension?.placements.find(p=>p.id===options.placementId&&p.roomId===options.roomId),attachment=options.frameAttachment,descriptor=extension?.furnishings.find(f=>f.id===(attachment?.furnishingId??placement?.furnishingId)&&f.version===(attachment?.furnishingVersion??placement?.furnishingVersion));
 if((!placement&&!attachment)||!descriptor||attachment&&!extension?.frameAttachments?.some(a=>a.placementId===attachment.placementId&&a.furnishingId===attachment.furnishingId))throw Error('WORKSPACE_PLACEMENT_INVALID');
 const rights=descriptor.rights as {permissions?:{display?:unknown};expiresAt?:unknown}|null,expires=rights?.expiresAt===undefined?Infinity:typeof rights.expiresAt==='string'?Date.parse(rights.expiresAt):NaN;
 if(rights?.permissions?.display!==true||Number.isNaN(expires)||Date.now()>=expires)throw Error('WORKSPACE_MODEL_AUTHORITY');
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const pose=placement&&structuredClone(placement);let source:WorkspaceModelSource,loaded:Awaited<ReturnType<typeof loadWorkspaceFurnishingModel>>;
 try{source=options.source??ownerWorkspaceModelSource(options.scope,descriptor,controller.signal);loaded=await loadWorkspaceFurnishingModel(three,options.renderer,descriptor.model,source,controller.signal,options.unavailable,options.budget,options.ledger);}catch(error){signal.removeEventListener('abort',abort);controller.abort();throw error;}
 let stopped=false,checking=false,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined,release:(()=>void)|undefined;
 const dispose=()=>{if(stopped)return;stopped=true;controller.abort();if(timer)clearInterval(timer);if(expiryTimer)clearTimeout(expiryTimer);signal.removeEventListener('abort',abort);signal.removeEventListener('abort',onAbort);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',enforce);loaded.object.visible=false;loaded.dispose();release?.();};
 const changed=()=>{try{options.onVisibilityChange?.();}catch{/* Rendering callbacks cannot grant authority. */}};
 const fail=(error:unknown)=>{if(stopped)return;try{dispose();}catch{/* Failed resource cleanup retains the scene and byte holds. */}changed();try{options.onRevoked(error);}catch{/* Consumer notification cannot restore visibility. */}};
 const enforce=()=>{if(stopped)return false;try{if(controller.signal.aborted||options.unavailable()||Date.now()>=expires){fail(Error('WORKSPACE_MODEL_AUTHORITY'));return false;}return true;}catch(error){fail(error);return false;}};
 const onAbort=()=>fail(signal.reason);
 const scheduleExpiry=()=>{if(!Number.isFinite(expires))return;expiryTimer=setTimeout(()=>{if(enforce())scheduleExpiry();},Math.min(2147483647,Math.max(0,expires-Date.now())));};
 try{
  controller.signal.throwIfAborted();release=options.scope.reserve(loaded.draws,loaded.triangles);if(!enforce())throw Error('WORKSPACE_MODEL_AUTHORITY');
  if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
  if(attachment){
   const doc=candidate as unknown as Exhibition,target=doc.placements.find(p=>p.id===attachment.placementId&&p.roomId===options.roomId),art=doc.artworks.find(a=>a.revisionId===attachment.artworkRevisionId);if(!target||!art)throw Error('WORKSPACE_PLACEMENT_INVALID');
   loaded.object.matrix.copy(artworkFrameMatrix(three,target.transform,art.transform));loaded.object.matrixAutoUpdate=false;
  }else if(pose){loaded.object.position.set(...pose.position);loaded.object.rotation.set(0,pose.yaw,0);loaded.object.scale.setScalar(pose.scale);}
  room.add(loaded.object);if(!enforce())throw Error('WORKSPACE_MODEL_AUTHORITY');
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();if(stopped)throw Error('WORKSPACE_MODEL_AUTHORITY');if(!options.sceneManagedAuthority){if(typeof document!=='undefined')document.addEventListener('visibilitychange',enforce);scheduleExpiry();}
  if(!options.sceneManagedAuthority)timer=setInterval(()=>{if(!enforce()||checking)return;checking=true;loaded.object.visible=false;changed();void Promise.resolve().then(()=>source.check()).then(()=>{if(enforce()){loaded.object.visible=true;changed();}}).catch(fail).finally(()=>{checking=false;});},5000);
  return {object:loaded.object,dispose,enforce};
 }catch(error){try{dispose();}catch{/* Retain the reservation if cleanup is uncertain. */}throw error;}
}
