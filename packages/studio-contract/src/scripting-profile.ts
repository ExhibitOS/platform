// SPDX-License-Identifier: AGPL-3.0-or-later
import {validateSpatialProgram,type SpatialProgram,type SpatialScope,type SpatialValidation} from './scripting.js';
export const SPATIAL_NAMESPACE='org.exhibitos.runtime/spatial-scripting';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Scene identities are references only, never grants of display/audio authorization. */
export function spatialScopeFor(candidate:unknown):SpatialScope {
 const ids=(key:string)=>new Set(object(candidate)&&Array.isArray(candidate[key])?candidate[key].filter(object).flatMap(v=>typeof v.id==='string'?[v.id]:[]):[]);
 return {rooms:ids('rooms'),zones:ids('audioZones'),placements:ids('placements'),lights:ids('lights'),mediaAssets:ids('mediaAssets')};
}
export function validateSpatialProfile(candidate:unknown):SpatialValidation {
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,SPATIAL_NAMESPACE))return {valid:true,errors:[]};
 const value=candidate.extensions[SPATIAL_NAMESPACE],checked=validateSpatialProgram(value,spatialScopeFor(candidate));
 const prefix='/extensions/org.exhibitos.runtime~1spatial-scripting';
 if(!checked.valid)return {valid:false,errors:checked.errors.map(e=>({...e,path:prefix+e.path}))};
 if(new TextEncoder().encode(JSON.stringify(value)).length>16384)return {valid:false,errors:[{code:'SPATIAL_PROFILE_LIMIT',path:prefix,message:'Embedded spatial program maximum16KiB'}]};
 return {valid:true,errors:[]};
}
/** Call after complete exhibition/profile validation; absent profile has no behavior. */
export function spatialProgramFor(candidate:{extensions?:unknown}):SpatialProgram {
 return structuredClone((object(candidate.extensions)?candidate.extensions[SPATIAL_NAMESPACE]:undefined)??{version:1,rules:[]}) as SpatialProgram;
}
/** Remap only scene entity references; author rule IDs/event names/prose remain unchanged. */
export function remapSpatialProgram(program:SpatialProgram,map:(id:string)=>string):SpatialProgram {
 const copy=structuredClone(program);
 const remap=(v:Record<string,unknown>)=>{for(const key of ['roomId','zoneId','placementId','lightId','mediaAssetId'])if(typeof v[key]==='string')v[key]=map(v[key]);};
 for(const rule of copy.rules){remap(rule.trigger as unknown as Record<string,unknown>);for(const action of rule.actions)remap(action as unknown as Record<string,unknown>);}
 return copy;
}
/** Product publication policy: each audio command retains an authored readable original. */
export function spatialAudioWithoutTranscript(candidate:unknown):string[] {
 if(!validateSpatialProfile(candidate).valid)return [];
 const program=spatialProgramFor(object(candidate)?candidate:{}),readable=new Set<string>();
 if(object(candidate)&&Array.isArray(candidate.audioZones))for(const zone of candidate.audioZones)if(object(zone)&&typeof zone.assetId==='string'&&typeof zone.transcript==='string'&&zone.transcript.trim())readable.add(zone.assetId);
 const extensions=object(candidate)&&object(candidate.extensions)?candidate.extensions:{};
 const experience=extensions['org.exhibitos.viewer/experience'];
 if(object(experience)&&Array.isArray(experience.voices))for(const voice of experience.voices)if(object(voice)&&typeof voice.assetId==='string'&&typeof voice.transcript==='string'&&voice.transcript.trim())readable.add(voice.assetId);
 return [...new Set(program.rules.flatMap(rule=>rule.actions.flatMap(action=>action.type==='play_audio'&&!readable.has(action.mediaAssetId)?[action.mediaAssetId]:[])))];
}
