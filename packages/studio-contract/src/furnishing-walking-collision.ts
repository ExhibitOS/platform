// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {wallFinishesFor} from './architectural-finishes.js';
import {benchesFor} from './benches.js';
import {experienceFor} from './experience.js';
import {furnishingsFor} from './furnishings.js';
import {INSTALLATION_NAMESPACE,type StudioInstallation} from './installation.js';
import {plaquesFor} from './plaques.js';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

export const FURNISHING_WALKING_COLLISION_NAMESPACE='org.exhibitos.studio/furnishing-walking-collision';
export const FURNISHING_WALKING_COLLISION_PROFILE='furnishing-walking-collision-v1';
export type FurnishingWalkingCollisionKind='workspace'|'bench'|'plinth'|'light'|'frame'|'opening'|'baseboard'|'sign';
export interface FurnishingWalkingCollisionTarget {kind:FurnishingWalkingCollisionKind;id:string}
export interface FurnishingWalkingCollisionOverride extends FurnishingWalkingCollisionTarget {enabled:boolean}
export interface FurnishingWalkingCollisionSettings {version:1;overrides:FurnishingWalkingCollisionOverride[]}
export interface FurnishingWalkingCollisionState extends FurnishingWalkingCollisionTarget {defaultEnabled:boolean;override?:boolean}
const maxOverrides=1024;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,...fields:string[])=>Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
const key=(kind:unknown,id:string)=>kind+':'+id.toLowerCase();
const namespace=FURNISHING_WALKING_COLLISION_NAMESPACE;

/** Targets belong to a physical furnishing, never to a catalogue entry.
 * A linked seat uses the same target as its workspace visual. */
export function furnishingWalkingCollisionTargets(document:Exhibition):FurnishingWalkingCollisionState[]{
 const targets=new Map<string,FurnishingWalkingCollisionState>();
 const add=(kind:FurnishingWalkingCollisionKind,id:string,defaultEnabled:boolean)=>{
  targets.set(key(kind,id),{kind,id,defaultEnabled});
 };
 const workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 const exits=new Set((experienceFor(document).exitDoors??[]).map(row=>row.placementId.toLowerCase()));
 for(const row of workspace?.placements??[]){
  const source=workspace?.furnishings.find(item=>item.id===row.furnishingId&&item.version===row.furnishingVersion);
  if(!source)continue;
  const on=!exits.has(row.id.toLowerCase())&&row.position[1]<1.75&&
   (source.kind==='bench'||source.kind==='stool'||source.kind==='pedestal'||source.kind==='barrier'||
    source.kind==='partition'||source.kind==='display-case'||source.kind==='info-stand');
  add('workspace',row.id,on);
 }
 for(const bench of benchesFor(document))if(!bench.workspaceVisual)add('bench',bench.id,bench.position[1]<1.75);
 const installation=document.extensions?.[INSTALLATION_NAMESPACE] as unknown as StudioInstallation|undefined;
 for(const row of installation?.placements??[]){
  if(row.pedestal&&row.pedestal.kind!=='none')add('plinth',row.placementId,row.pedestal.position[1]<1.75);
  if(row.frame&&row.frame.kind!=='none')add('frame',row.placementId,false);
 }
 for(const light of document.lights??[])add('light',light.id,false);
 for(const row of workspace?.frameAttachments??[])add('frame',row.placementId,false);
 for(const row of workspace?.openingAttachments??[])add('opening',row.openingId,false);
 for(const row of furnishingsFor(document)?.bindings??[])if(row.hostKind==='opening')add('opening',row.hostId,false);
 for(const row of wallFinishesFor(document))if(row.preset!=='plain')add('baseboard',row.surfaceId,false);
 for(const row of plaquesFor(document))add('sign',row.id,false);
 return [...targets.values()];
}

export function validateFurnishingWalkingCollision(document:Exhibition){
 const fail=()=>({valid:false,errors:[{code:'FURNISHING_WALKING_COLLISION_INVALID',path:'/extensions/org.exhibitos.studio~1furnishing-walking-collision',message:'Walking Collision settings must refer to distinct existing furnishings.'}]});
 const extensions=document.extensions;
 if(!extensions||!Object.hasOwn(extensions,namespace))return {valid:true,errors:[]};
 const value=extensions[namespace];
 if(!object(value)||!keys(value,'version','overrides')||value.version!==1||!Array.isArray(value.overrides)||value.overrides.length>maxOverrides)return fail();
 try{
  const valid=new Set(furnishingWalkingCollisionTargets(document).map(row=>key(row.kind,row.id)));
  for(const row of value.overrides){
   if(!object(row)||!keys(row,'kind','id','enabled')||typeof row.kind!=='string'||typeof row.id!=='string'||typeof row.enabled!=='boolean'||!valid.delete(key(row.kind,row.id)))return fail();
  }
 }catch{return fail();}
 return {valid:true,errors:[]};
}

export function furnishingWalkingCollisionState(document:Exhibition):FurnishingWalkingCollisionState[]{
 if(!validateFurnishingWalkingCollision(document).valid)throw Error('FURNISHING_WALKING_COLLISION_INVALID');
 const settings=document.extensions?.[namespace] as unknown as FurnishingWalkingCollisionSettings|undefined;
 const overrides=new Map(settings?.overrides.map(row=>[key(row.kind,row.id),row.enabled]));
 return furnishingWalkingCollisionTargets(document).map(row=>{
  const override=overrides.get(key(row.kind,row.id));
  return override===undefined?row:{...row,override};
 });
}

/** Null clears an authored choice. A boolean is retained even when it equals the current default. */
export function applyFurnishingWalkingCollisionOverride(document:Exhibition,target:FurnishingWalkingCollisionTarget,enabled:boolean|null):Exhibition{
 const id=key(target.kind,target.id),state=furnishingWalkingCollisionState(document).find(row=>key(row.kind,row.id)===id);
 if(!state)throw Error('FURNISHING_WALKING_COLLISION_REFERENCE');
 if(state.override===(enabled??undefined))return document;
 const extensions:NonNullable<Exhibition['extensions']>={...document.extensions};
 const settings=extensions[namespace] as unknown as FurnishingWalkingCollisionSettings|undefined;
 const overrides=(settings?.overrides??[]).filter(row=>key(row.kind,row.id)!==id);
 if(enabled!==null)overrides.push({kind:state.kind,id:state.id,enabled});
 if(overrides.length>maxOverrides)throw Error('FURNISHING_WALKING_COLLISION_LIMIT');
 if(overrides.length)extensions[namespace]={version:1,overrides} as unknown as NonNullable<Exhibition['extensions']>[string];
 else delete extensions[namespace];
 return {...document,extensions};
}

/** Reconcile a trusted host edit with its validated baseline. */
export function reconcileFurnishingWalkingCollision(before:Exhibition,after:Exhibition):Exhibition{
 const prior=before.extensions?.[namespace];
 if(!prior||JSON.stringify(prior)!==JSON.stringify(after.extensions?.[namespace])||
    !validateFurnishingWalkingCollision(before).valid)return after;
 const targets=new Set(furnishingWalkingCollisionTargets(after).map(row=>key(row.kind,row.id)));
 const linked=new Map(benchesFor(after).flatMap(bench=>bench.workspaceVisual?
  [[key('bench',bench.id),bench.workspaceVisual.placementId] as const]:[]));
 const settings=prior as unknown as FurnishingWalkingCollisionSettings;
 const overrides=settings.overrides.flatMap(row=>{
  const target=key(row.kind,row.id);
  if(targets.has(target))return [row];
  const placementId=linked.get(target);
  if(!placementId||!targets.has(key('workspace',placementId))||
     settings.overrides.some(other=>key(other.kind,other.id)===key('workspace',placementId)))return [];
  return [{kind:'workspace' as const,id:placementId,enabled:row.enabled}];
 });
 if(overrides.length===settings.overrides.length&&overrides.every((row,index)=>row===settings.overrides[index]))return after;
 const extensions:NonNullable<Exhibition['extensions']>={...after.extensions};
 if(overrides.length)extensions[namespace]={version:1,overrides:overrides.map(row=>({...row}))};
 else delete extensions[namespace];
 return {...after,extensions};
}

/** Resolve once per scene. Geometry consumers keep their own visibility and
 * admission checks even when the author requests collision. */
export function furnishingWalkingCollisionLookup(document:Exhibition){
 const settings=new Map(furnishingWalkingCollisionState(document).map(row=>[key(row.kind,row.id),row.override??row.defaultEnabled]));
 return (kind:FurnishingWalkingCollisionKind,id:string)=>settings.get(key(kind,id))===true;
}

/** Remap each target after its host has been projected. Missing hosts may not
 * silently lose an explicit author choice. */
export function remapFurnishingWalkingCollision(settings:FurnishingWalkingCollisionSettings,ids:ReadonlyMap<string,string>):FurnishingWalkingCollisionSettings{
 return {version:1,overrides:settings.overrides.map(row=>{
  const id=ids.get(row.id.toLowerCase());
  if(!id)throw Error('FURNISHING_WALKING_COLLISION_REFERENCE');
  return {...row,id};
 })};
}
