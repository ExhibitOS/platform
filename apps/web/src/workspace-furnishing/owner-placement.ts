// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {DeviceBudget} from '../viewer/loading';
import {AssetPeakBudget} from '../viewer/loading';
import {loadWorkspaceFurnishingModel} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';
import {OwnerPreviewBudget} from './owner-preview-budget';

/** Owner preview only. Use the same scope for all placements in a scene and
 * call enforce() before each render, including after a suspended tab resumes.
 * Server-side rechecks remain required; no public authority is implied. */
export async function mountOwnerWorkspacePlacement(options:{three:typeof Three;renderer:Three.WebGLRenderer;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};scope:OwnerPreviewBudget;roomId:string;placementId:string;room:Three.Object3D;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;ledger:AssetPeakBudget;onRevoked:(error:unknown)=>void}){
 const {candidate,three,room,signal}=options;
 if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined,placement=extension?.placements.find(p=>p.id===options.placementId&&p.roomId===options.roomId),descriptor=extension?.furnishings.find(f=>f.id===placement?.furnishingId&&f.version===placement.furnishingVersion);
 if(!placement||!descriptor)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const rights=descriptor.rights as {permissions?:{display?:unknown};expiresAt?:unknown}|null,expires=rights?.expiresAt===undefined?Infinity:typeof rights.expiresAt==='string'?Date.parse(rights.expiresAt):NaN;
 if(rights?.permissions?.display!==true||Number.isNaN(expires)||Date.now()>=expires)throw Error('WORKSPACE_MODEL_AUTHORITY');
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const pose=structuredClone(placement),source=ownerWorkspaceModelSource(options.scope,descriptor,controller.signal);let loaded:Awaited<ReturnType<typeof loadWorkspaceFurnishingModel>>;
 try{loaded=await loadWorkspaceFurnishingModel(three,options.renderer,descriptor.model,source,controller.signal,options.unavailable,options.budget,options.ledger);}catch(error){signal.removeEventListener('abort',abort);controller.abort();throw error;}
 let stopped=false,checking=false,timer:ReturnType<typeof setInterval>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined,release:(()=>void)|undefined;
 const dispose=()=>{if(stopped)return;stopped=true;controller.abort();if(timer)clearInterval(timer);if(expiryTimer)clearTimeout(expiryTimer);signal.removeEventListener('abort',abort);signal.removeEventListener('abort',onAbort);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',enforce);loaded.object.visible=false;loaded.dispose();release?.();};
 const fail=(error:unknown)=>{if(stopped)return;try{dispose();}catch{/* Failed resource cleanup retains the scene and byte holds. */}try{options.onRevoked(error);}catch{/* Consumer notification cannot restore visibility. */}};
 const enforce=()=>{if(stopped)return false;try{if(controller.signal.aborted||options.unavailable()||Date.now()>=expires){fail(Error('WORKSPACE_MODEL_AUTHORITY'));return false;}return true;}catch(error){fail(error);return false;}};
 const onAbort=()=>fail(signal.reason);
 const scheduleExpiry=()=>{if(!Number.isFinite(expires))return;expiryTimer=setTimeout(()=>{if(enforce())scheduleExpiry();},Math.min(2147483647,Math.max(0,expires-Date.now())));};
 try{
  controller.signal.throwIfAborted();release=options.scope.reserve(loaded.draws,loaded.triangles);if(!enforce())throw Error('WORKSPACE_MODEL_AUTHORITY');
  loaded.object.position.set(...pose.position);loaded.object.rotation.set(0,pose.yaw,0);loaded.object.scale.setScalar(pose.scale);room.add(loaded.object);
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();if(typeof document!=='undefined')document.addEventListener('visibilitychange',enforce);scheduleExpiry();
  timer=setInterval(()=>{if(!enforce()||checking)return;checking=true;loaded.object.visible=false;void source.check().then(()=>{if(enforce())loaded.object.visible=true;}).catch(fail).finally(()=>{checking=false;});},5000);
  return {object:loaded.object,dispose,enforce};
 }catch(error){try{dispose();}catch{/* Retain the reservation if cleanup is uncertain. */}throw error;}
}
