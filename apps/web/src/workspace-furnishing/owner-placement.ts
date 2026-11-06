// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {DeviceBudget} from '../viewer/loading';
import {AssetPeakBudget} from '../viewer/loading';
import {loadWorkspaceFurnishingModel} from './model-loader';
import {ownerWorkspaceModelSource} from './owner-source';

/** Mount one owner-preview placement in its caller-provided room. Rechecks hide
 * the model while pending and remove it on denial. This is periodic validation,
 * not an instant server-pushed revocation guarantee or public authorization. */
export async function mountOwnerWorkspacePlacement(options:{three:typeof Three;renderer:Three.WebGLRenderer;candidate:{extensions?:Record<string,unknown>;rooms?:unknown};tenantId:string;roomId:string;placementId:string;room:Three.Object3D;signal:AbortSignal;unavailable:()=>boolean;budget:DeviceBudget;ledger:AssetPeakBudget;onRevoked:(error:unknown)=>void;fetcher?:typeof fetch}){
 const {candidate,three,room,signal}=options;
 if(!validateWorkspaceFurnishings(candidate).valid)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const extension=candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined,placement=extension?.placements.find(p=>p.id===options.placementId&&p.roomId===options.roomId),descriptor=extension?.furnishings.find(f=>f.id===placement?.furnishingId&&f.version===placement.furnishingVersion);
 if(!placement||!descriptor)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const pose=structuredClone(placement),source=ownerWorkspaceModelSource(options.tenantId,descriptor,signal,options.fetcher),loaded=await loadWorkspaceFurnishingModel(three,options.renderer,descriptor.model,source,signal,options.unavailable,options.budget,options.ledger);
 let stopped=false,checking=false,timer:ReturnType<typeof setInterval>|undefined;
 const dispose=()=>{if(stopped)return;stopped=true;if(timer)clearInterval(timer);signal.removeEventListener('abort',dispose);loaded.object.visible=false;loaded.dispose();};
 try{
  signal.throwIfAborted();if(options.unavailable())throw Error('WORKSPACE_MODEL_INACTIVE');
  loaded.object.position.set(...pose.position);loaded.object.rotation.set(0,pose.yaw,0);loaded.object.scale.setScalar(pose.scale);room.add(loaded.object);
  signal.addEventListener('abort',dispose,{once:true});
  timer=setInterval(()=>{if(stopped||checking)return;checking=true;loaded.object.visible=false;void source.check().then(()=>{if(!stopped&&!signal.aborted&&!options.unavailable())loaded.object.visible=true;else dispose();},error=>{if(!stopped){try{dispose();}finally{options.onRevoked(error);}}}).finally(()=>{checking=false;});},5000);
  return {object:loaded.object,dispose};
 }catch(error){dispose();throw error;}
}
