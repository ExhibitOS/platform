// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {TEMPLATE_NAMESPACE} from './architecture.js';

/** Exhibition-wide visual controls, independent of daylight and authored lights. */
export const SPACE_LIGHTING_NAMESPACE='org.exhibitos.studio/space-lighting';
export const ROOM_LOCAL_SPACE_LIGHTING_MODE='room-local' as const;
export interface SpaceLighting {version:1;baselineIntensity:number;reflectionIntensity:number;mode?:typeof ROOM_LOCAL_SPACE_LIGHTING_MODE}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const unit=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
export function validateSpaceLighting(candidate:unknown){
  const errors:{code:string;path:string;message:string}[]=[];
  if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,SPACE_LIGHTING_NAMESPACE))return {valid:true,errors};
  const v=candidate.extensions[SPACE_LIGHTING_NAMESPACE];
  const required=['version','baselineIntensity','reflectionIntensity'];
  if(!object(v)||!required.every(k=>Object.hasOwn(v,k))||Object.keys(v).some(k=>k!=='mode'&&!required.includes(k))||
     v.version!==1||!unit(v.baselineIntensity)||!unit(v.reflectionIntensity)||
     Object.hasOwn(v,'mode')&&(v.mode!==ROOM_LOCAL_SPACE_LIGHTING_MODE||v.baselineIntensity!==0||v.reflectionIntensity!==0))
    errors.push({code:'SPACE_LIGHTING_INVALID',path:'/candidate/extensions/org.exhibitos.studio~1space-lighting',
      message:'Expected version 1 intensities from 0 to 1, both zero in room-local mode'});
  return {valid:errors.length===0,errors};
}
/** Call after admission. Absence stays absent; zero is an explicit setting. */
export function spaceLightingFor(candidate:Pick<Exhibition,'extensions'>):SpaceLighting|undefined {
  const value=candidate.extensions?.[SPACE_LIGHTING_NAMESPACE];
  return value===undefined?undefined:structuredClone(value) as unknown as SpaceLighting;
}
/** Atomic extension-only edit. null removes the override; loading never calls this. */
export function setSpaceLighting(candidate:Exhibition,settings:SpaceLighting|null):Exhibition {
  const next=structuredClone(candidate),previous=spaceLightingFor(candidate);
  if(settings===null){
    if(previous===undefined)return next;
    delete next.extensions![SPACE_LIGHTING_NAMESPACE];
  }else{
    const value=structuredClone(settings);
    if(!validateSpaceLighting({extensions:{[SPACE_LIGHTING_NAMESPACE]:value}}).valid)throw Error('SPACE_LIGHTING_INVALID');
    if(previous?.version===value.version&&previous.baselineIntensity===value.baselineIntensity&&previous.reflectionIntensity===value.reflectionIntensity&&previous.mode===value.mode)return next;
    next.extensions={...next.extensions,[SPACE_LIGHTING_NAMESPACE]:value as unknown as NonNullable<Exhibition['extensions']>[string]};
  }
  const template=next.extensions?.[TEMPLATE_NAMESPACE];
  if(template&&typeof template==='object'&&!Array.isArray(template))template.modified=true;
  return next;
}

/** Opt in through a room-default action without replacing an authored global choice. */
export function ensureRoomLocalSpaceLighting(candidate:Exhibition):Exhibition {
  if (spaceLightingFor(candidate)!==undefined) return candidate;
  return setSpaceLighting(candidate,{version:1,baselineIntensity:0,reflectionIntensity:0,mode:ROOM_LOCAL_SPACE_LIGHTING_MODE});
}
