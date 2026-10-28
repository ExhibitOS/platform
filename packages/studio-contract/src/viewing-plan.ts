// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import { presentationFor, validateStudioPresentation } from './index.js';

export const VIEWING_PLAN_NAMESPACE = 'org.exhibitos.viewer/viewing-plan';
export const VIEWING_PLAN_LIMITS = Object.freeze({ stops: 128, bytes: 32768 });
/** Radians relative to the authored viewpoint after room-to-world projection.
 * Its existing world target, radius, eye height and FOV remain authoritative.
 * Bounds do not certify collision clearance or enable automatic rotation.
 */
export interface ViewingOrbit { minYaw: number; maxYaw: number }
export interface ViewingStop { placementId: string; viewpointId: string; orbit?: ViewingOrbit }
export interface ViewingPlan { version: 1; stops: ViewingStop[] }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const closed=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateViewingPlan(candidate: unknown) {
 const errors:{code:string;path:string;message:string}[]=[];
 const fail=(suffix:string,message:string)=>errors.push({code:'VIEWING_PLAN_INVALID',path:'/candidate/extensions/org.exhibitos.viewer~1viewing-plan'+suffix,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,VIEWING_PLAN_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[VIEWING_PLAN_NAMESPACE];
 if(!object(value)||!closed(value,['version','stops'])||value.version!==1||!Array.isArray(value.stops)||value.stops.length>VIEWING_PLAN_LIMITS.stops){fail('','Expected closed viewing-plan v1 with at most128 stops');return {valid:false,errors};}
 if(!validateStudioPresentation(candidate).valid){fail('','A compatible authored presentation catalog is required');return {valid:false,errors};}
 const placements=Array.isArray(candidate.placements)?candidate.placements.filter(object):[];
 const artworks=Array.isArray(candidate.artworks)?candidate.artworks.filter(object):[];
 const views=presentationFor(candidate).viewpoints,seen=new Set<string>();
 for(const [i,stop]of value.stops.entries()){
  const path='/stops/'+i;
  if(!object(stop)||!closed(stop,stop.orbit===undefined?['placementId','viewpointId']:['placementId','viewpointId','orbit'])||!uuid(stop.placementId)||!uuid(stop.viewpointId)){fail(path,'Expected existing placement and viewpoint UUID references');continue;}
  const id=stop.placementId.toLowerCase(),placement=placements.find(p=>typeof p.id==='string'&&p.id.toLowerCase()===id);
  if(seen.has(id)||!placement||!views.some(v=>v.id.toLowerCase()===(stop.viewpointId as string).toLowerCase()))fail(path,'References must exist and placement identities must be unique');
  seen.add(id);
  if(stop.orbit!==undefined){
   const orbit=stop.orbit,artwork=artworks.find(a=>typeof a.revisionId==='string'&&typeof placement?.artworkRevisionId==='string'&&a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
   if(!object(orbit)||!closed(orbit,['minYaw','maxYaw'])||typeof orbit.minYaw!=='number'||typeof orbit.maxYaw!=='number'||!Number.isFinite(orbit.minYaw)||!Number.isFinite(orbit.maxYaw)||orbit.minYaw< -Math.PI||orbit.minYaw>0||orbit.maxYaw<0||orbit.maxYaw>Math.PI||orbit.minYaw>=orbit.maxYaw||artwork?.artworkType!=='sculpture')fail(path+'/orbit','Only sculpture stops support finite relative yaw bounds -PI..0..PI');
  }
 }
 try{if(new TextEncoder().encode(JSON.stringify(value)).length>VIEWING_PLAN_LIMITS.bytes)fail('','Maximum32KiB viewing plan');}catch{fail('','JSON metadata required');}
 return {valid:errors.length===0,errors};
}
/** Read only after validation; unknown/private source JSON is never modified. */
export function viewingPlanFor(candidate:{extensions?:unknown}):ViewingPlan {
 const value=object(candidate.extensions)?candidate.extensions[VIEWING_PLAN_NAMESPACE]:undefined;
 return structuredClone(value===undefined?{version:1,stops:[]}:value) as ViewingPlan;
}
/** Rewrite only the two typed references. Missing mappings fail closed. */
export function remapViewingPlan(value:ViewingPlan,ids:ReadonlyMap<string,string>):ViewingPlan {
 const normalized=new Map([...ids].map(([a,b])=>[a.toLowerCase(),b]));
 const map=(id:string)=>{const next=normalized.get(id.toLowerCase());if(!uuid(next))throw Error('VIEWING_PLAN_REFERENCE');return next;};
 return {version:1,stops:value.stops.map(s=>({...structuredClone(s),placementId:map(s.placementId),viewpointId:map(s.viewpointId)}))};
}

/** Explicit profile-only edit. Loading never invokes this setter. */
export function setViewingPlan(candidate:Exhibition,plan:ViewingPlan|null):Exhibition {
 const next=structuredClone(candidate);
 if(plan===null){if(next.extensions)delete next.extensions[VIEWING_PLAN_NAMESPACE];return next;}
 const value=structuredClone(plan);
 next.extensions={...next.extensions,[VIEWING_PLAN_NAMESPACE]:value as unknown as NonNullable<Exhibition['extensions']>[string]};
 if(!validateViewingPlan(next).valid)throw Error('VIEWING_PLAN_INVALID');
 return next;
}
