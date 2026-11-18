// SPDX-License-Identifier: AGPL-3.0-or-later
import {resolveTrackSpotAiming} from './track-spot-aiming-resolver.js';
import {validateTrackSpotAimBinding,type TrackSpotAimBinding} from './track-spot-aim-binding.js';
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,validateArtifactPose} from './artifact-affine.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';
import {freezeCanonical} from './freeze.js';
import {benchesFor} from './benches.js';
import {applyFurnishingCommand,furnishingAsset,furnishingsFor,validateFurnishings,FURNISHING_NAMESPACE,SUPPORTED_FURNISHINGS,type FurnishingCatalogId,type FurnishingPose} from './furnishings.js';
import {lightDetailsFor,setLightDetails,setRoomBaseLightPlacement,setRoomCeilingFillBrightness,manualizeRoomBaseLight,sameLightPose,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE,type ExhibitionLight,type LightDetails} from './light-details.js';
import {lightAttachmentsFor,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE,assertRoomEnvelopeContents,assertRoomEnvelopeContentsAgainstBaseline,type LightAttachment} from './room-envelope.js';

export type LightObjectCommand=
 |{type:'set-light-object';lightId:string;light:Omit<ExhibitionLight,'id'>;settings:Omit<LightDetails,'lightId'>;attachment?:Omit<LightAttachment,'lightId'>|null}
 |{type:'set-room-base-light-placement';lightId:string;basePlacement:'auto'|'manual'}
 |{type:'set-room-ceiling-fill-brightness';lightId:string;brightness:number}
 |{type:'set-light-fixture';lightId:string;visual:null|{catalogId:FurnishingCatalogId;catalogVersion:1;pose:FurnishingPose;trackAim?:TrackSpotAimBinding}}
 |{type:'duplicate-light-object';lightId:string}
 |{type:'remove-light-object';lightId:string};
export interface LightObjectOptions {newLightId?:string;newAssetId?:string;verifiedBaseline?:Exhibition}
const fail=(code='LIGHT_OBJECT_INVALID'):never=>{throw Error(code);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,required:string[],optional:string[]=[])=>object(v)&&Reflect.ownKeys(v).length===Object.keys(v).length&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const ownedNamespaces=new Set([LIGHT_DETAILS_NAMESPACE,LIGHT_ATTACHMENT_NAMESPACE,FURNISHING_NAMESPACE]);
function hasReference(value:unknown,id:string):boolean {
 if(typeof value==='string')return same(value,id);
 if(Array.isArray(value))return value.some(v=>hasReference(v,id));
 return object(value)&&Object.entries(value).some(([key,v])=>same(key,id)||hasReference(v,id));
}
/** Unknown references are not guessed/remapped. Exact UUID-valued prose may
 * conservatively require an explicit owner command before destructive removal. */
function assertNoForeignReference(document:Exhibition,id:string){
 const rest={...document,lights:undefined,extensions:Object.fromEntries(Object.entries(document.extensions??{}).filter(([name])=>!ownedNamespaces.has(name)))};
 if(hasReference(rest,id))fail('LIGHT_OBJECT_REFERENCED');
}
/** Only declared schema positions define identities. Opaque extension/metadata
 * fields named id or revisionId may be references and are never reinterpreted. */
function identityCount(document:Exhibition,id:string):number {
 const definitions:unknown[]=[document,...document.rooms,...(document.surfaces??[]),...(document.openings??[]),...document.placements,...document.lights,
  ...(document.artworks??[]),...(document.mediaAssets??[]),...(document.navigation??[]),...(document.audioZones??[]),...(document.annotations??[]),...(document.scripts??[]),
  ...(document.artworks??[]).flatMap(a=>a.assets??[]),...benchesFor(document),...(furnishingsFor(document)?.assets??[])];
 const still=document.extensions?.['org.exhibitos.viewer/space-still'];if(object(still)&&object(still.asset))definitions.push(still.asset);
 return definitions.reduce<number>((count,value)=>count+(object(value)?[value.id,value.revisionId].filter(v=>typeof v==='string'&&same(v,id)).length:0),0);
}
function assertFreshId(document:Exhibition,id:unknown){if(!uuid(id)||hasReference(document,id))fail('LIGHT_OBJECT_ID_COLLISION');}
function assertLight(document:Exhibition,light:ExhibitionLight){
 // Base OES has no intensity/area-size cap. Presentation policy remains with
 // the caller; unrelated admitted manual lights are never converted here.
 if(!closed(light,['id','roomId','type','transform','color','intensity','unit','castsShadow'],['beamAngle','dimensions','targetPlacementId'])||!uuid(light.id)||!uuid(light.roomId)||!['point','spot','directional','area'].includes(light.type)||
  !closed(light.transform,['position','rotation','scale'])||!Array.isArray(light.color)||light.color.length!==3||!light.color.every(n=>finite(n,0,1))||!finite(light.intensity,0,Number.MAX_VALUE)||typeof light.castsShadow!=='boolean')fail();
 validateArtifactPose(light.transform);
 if(light.transform.scale.some(n=>n!==1))fail();
 const units={point:'candela',spot:'candela',directional:'lux',area:'lumen'} as const;
 if(light.unit!==units[light.type]||(light.type==='spot')!==Object.hasOwn(light,'beamAngle')||(light.type==='area')!==Object.hasOwn(light,'dimensions')||light.type==='spot'&&(!finite(light.beamAngle,0,Math.PI/2)||light.beamAngle===0))fail();
 if(light.type==='area'&&(!closed(light.dimensions,['width','height'])||!finite(light.dimensions?.width,Number.MIN_VALUE,Number.MAX_VALUE)||!finite(light.dimensions?.height,Number.MIN_VALUE,Number.MAX_VALUE)))fail();
 const room=document.rooms.find(r=>same(r.id,light.roomId));if(!room) return fail('LIGHT_OBJECT_REFERENCE');
 const p=light.transform.position,d=room.dimensions;
 if(Math.abs(p[0])>d.width/2||p[1]<0||p[1]>d.height||Math.abs(p[2])>d.depth/2)fail();artifactPoint(p,room.transform);
 if(Object.hasOwn(light,'targetPlacementId')){const target=document.placements.find(p=>typeof light.targetPlacementId==='string'&&same(p.id,light.targetPlacementId));if(!uuid(light.targetPlacementId)||!target||!same(target.roomId,light.roomId))fail('LIGHT_OBJECT_REFERENCE');}
 if(identityCount(document,light.id)!==1)fail('LIGHT_OBJECT_ID_COLLISION');
}
function assertDocument(document:Exhibition){
 if(!object(document)||!Array.isArray(document.lights)||document.lights.length>1024||!Array.isArray(document.rooms)||!Array.isArray(document.placements)||!validateFurnishings(document).valid||!validateStudioLightDetails(document).valid||!validateLightAttachments(document).valid)fail();
 for(const light of document.lights)assertLight(document,light);
}
function writeBindings(document:Exhibition,namespace:string,lights:unknown[]){
 document.extensions={...document.extensions,[namespace]:{version:1,lights} as NonNullable<Exhibition['extensions']>[string]};
}
function settingsFor(document:Exhibition,id:string):Omit<LightDetails,'lightId'>{
 const value=lightDetailsFor(document).find(v=>same(v.lightId,id));if(!value)return {fixture:'none'};
 const {lightId:_,...settings}=value;void _;return settings;
}
function lightFields(light:ExhibitionLight):Omit<ExhibitionLight,'id'>{const {id:_,...fields}=light;void _;return fields;}

/** Atomic, detached candidate only. Caller admits the complete base document and
 * owns durable history/CAS. No legacy load reconciliation or namespace remap. */
export function applyLightObjectCommand(document:Exhibition,command:LightObjectCommand,options:LightObjectOptions={}):{candidate:Exhibition;lightId:string}{
 assertDocument(document);
 if(!object(command)||!uuid(command.lightId))fail();
 const light=document.lights.find(v=>same(v.id,command.lightId));if(!light)return fail('LIGHT_OBJECT_REFERENCE');
 let next=structuredClone(document),lightId=light.id;
 switch(command.type){
  case 'set-light-object':{
   if(!closed(command,['type','lightId','light','settings'],['attachment'])||!object(command.light)||!object(command.settings)||Object.hasOwn(command.light,'id')||Object.hasOwn(command.settings,'lightId'))fail();
   next=setLightDetails(next,light.id,command.light,command.settings);
   if(command.settings.trackAim){const result=resolveTrackSpotAiming(next,light.id);
    if(!result.reachable){
      const code='TRACK_SPOT_AIM_'+result.reason;
      throw new Error(code,{cause:{code,remedy:result.remedy}});
    }
    const pose={position:[...result.emitter] as [number,number,number],rotation:[...result.headPose.rotation] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};if(!sameLightPose(command.light.transform,light.transform)&&!sameLightPose(command.light.transform,pose))fail('TRACK_SPOT_AIM_MOUNT_EDIT_REQUIRED');next.lights.find(v=>same(v.id,light.id))!.transform=pose;}
   if(Object.hasOwn(command,'attachment')){
    if(command.attachment!==null)next=manualizeRoomBaseLight(next,light.id);
    if(command.attachment===undefined||command.attachment!==null&&(!closed(command.attachment,['surfaceId','anchor','gap'])||Object.hasOwn(command.attachment,'lightId')))return fail();
    const bindings=lightAttachmentsFor(next),index=bindings.findIndex(v=>same(v.lightId,light.id));
    if(command.attachment===null){if(index>=0)bindings.splice(index,1);}else{const value={...structuredClone(command.attachment),lightId:light.id};if(index>=0)bindings[index]=value;else bindings.push(value);}
    if(next.extensions?.[LIGHT_ATTACHMENT_NAMESPACE]!==undefined||command.attachment!==null)writeBindings(next,LIGHT_ATTACHMENT_NAMESPACE,bindings);
   }
   break;
  }
  case 'set-room-base-light-placement':{
   if(!closed(command,['type','lightId','basePlacement']))fail();
   if(command.basePlacement==='auto'){
    const bindings=lightAttachmentsFor(next);
    if(next.extensions?.[LIGHT_ATTACHMENT_NAMESPACE]!==undefined)writeBindings(next,LIGHT_ATTACHMENT_NAMESPACE,bindings.filter(v=>!same(v.lightId,light.id)));
   }
   next=setRoomBaseLightPlacement(next,light.id,command.basePlacement);break;
  }
  case 'set-room-ceiling-fill-brightness':{
   if(!closed(command,['type','lightId','brightness'])||!finite(command.brightness,0,1))fail();
   next=setRoomCeilingFillBrightness(next,light.id,command.brightness);break;
  }
  case 'set-light-fixture':{
   if(!closed(command,['type','lightId','visual']))fail();
   if(command.visual?.catalogId==='museum-track-spot-articulated'){
    const visual=command.visual;
    if(!closed(visual,['catalogId','catalogVersion','pose','trackAim'])||visual.catalogVersion!==1||!validateTrackSpotAimBinding(visual.trackAim)||light.type!=='spot')fail('TRACK_SPOT_AIM_INVALID_BINDING');
    // One known-source mode change on a detached candidate. Build the visual,
    // mount intent and optics together before the unchanged complete admission;
    // no intermediate candidate is written or granted a validation bypass.
    const value=furnishingsFor(next)??{version:1 as const,assets:[],bindings:[]};
    let asset=value.assets.find(a=>a.catalogId==='museum-track-spot-articulated');
    if(!asset){const id=options.newAssetId??crypto.randomUUID();assertFreshId(next,id);asset=furnishingAsset(id,'museum-track-spot-articulated');value.assets.push(asset);}
    const row={hostKind:'light' as const,hostId:light.id,assetId:asset.id,pose:structuredClone(visual.pose)},at=value.bindings.findIndex(b=>b.hostKind==='light'&&same(b.hostId,light.id));
    if(at<0)value.bindings.push(row);else value.bindings[at]=row;
    value.assets=value.assets.filter(a=>value.bindings.some(b=>same(b.assetId,a.id)));
    next.extensions={...next.extensions,[FURNISHING_NAMESPACE]:value as unknown as NonNullable<Exhibition['extensions']>[string]};
    const details=lightDetailsFor(next),index=details.findIndex(b=>same(b.lightId,light.id)),prior=settingsFor(next,light.id);
    if(prior.purpose!==undefined||prior.basePlacement!==undefined)fail('TRACK_SPOT_AIM_INVALID_BINDING');
    const {aim:oldAim,trackAim:oldTrack,...retained}=prior;void oldAim;void oldTrack;
    const entry:LightDetails={...retained,lightId:light.id,fixture:'none',trackAim:structuredClone(visual.trackAim)};
    if(index<0)details.push(entry);else details[index]=entry;writeBindings(next,LIGHT_DETAILS_NAMESPACE,details);
    if(next.extensions?.[LIGHT_ATTACHMENT_NAMESPACE]!==undefined)writeBindings(next,LIGHT_ATTACHMENT_NAMESPACE,lightAttachmentsFor(next).filter(b=>!same(b.lightId,light.id)));
    const result=resolveTrackSpotAiming(next,light.id);
    if(!result.reachable){
      const code='TRACK_SPOT_AIM_'+result.reason;
      throw new Error(code,{cause:{code,remedy:result.remedy}});
    }
    next.lights.find(v=>same(v.id,light.id))!.transform={position:[...result.emitter],rotation:[...result.headPose.rotation],scale:[1,1,1]};
    break;
   }
   if(settingsFor(next,light.id).trackAim)fail('TRACK_SPOT_AIM_EXPLICIT_MODE_CHANGE_REQUIRED');
   if(command.visual===null){
    next=applyFurnishingCommand(next,{type:'remove-furnishing-visual',hostKind:'light',hostId:light.id});
    next=setLightDetails(next,light.id,lightFields(light),{...settingsFor(next,light.id),fixture:'none'});
   }else{
    if(!closed(command.visual,['catalogId','catalogVersion','pose'])||command.visual.catalogVersion!==1||SUPPORTED_FURNISHINGS[command.visual.catalogId]!=='light'||light.type!=='spot')fail();
    const existing=furnishingsFor(next)?.assets.find(a=>a.catalogId===command.visual!.catalogId);
    if(!existing&&options.newAssetId!==undefined)assertFreshId(next,options.newAssetId);
    next=setLightDetails(next,light.id,lightFields(light),{...settingsFor(next,light.id),fixture:'spot-can'});
    next=applyFurnishingCommand(next,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,...command.visual},options.newAssetId===undefined?undefined:{newAssetId:options.newAssetId});
   }
   break;
  }
  case 'duplicate-light-object':{
   if(!closed(command,['type','lightId'])||lightDetailsFor(next).some(v=>same(v.lightId,light.id)&&v.purpose==='room-base'))fail();
   assertFreshId(next,options.newLightId);lightId=options.newLightId!;
   next.lights.push({...structuredClone(light),id:lightId});
   for(const [namespace,bindings]of[[LIGHT_DETAILS_NAMESPACE,lightDetailsFor(next)],[LIGHT_ATTACHMENT_NAMESPACE,lightAttachmentsFor(next)]] as const){const source=bindings.find(v=>same(v.lightId,light.id));if(source)writeBindings(next,namespace,[...bindings,{...structuredClone(source),lightId}]);}
   const furnishings=furnishingsFor(next),binding=furnishings?.bindings.find(v=>v.hostKind==='light'&&same(v.hostId,light.id));
   if(furnishings&&binding){furnishings.bindings.push({...structuredClone(binding),hostId:lightId});next.extensions![FURNISHING_NAMESPACE]=furnishings as unknown as NonNullable<Exhibition['extensions']>[string];}
   break;
  }
  case 'remove-light-object':{
   if(!closed(command,['type','lightId']))fail();assertNoForeignReference(next,light.id);
   const prior=settingsFor(next,light.id);
   if(light.type==='point'&&prior.purpose==='room-base'&&!Object.hasOwn(prior,'basePlacement')&&!Object.hasOwn(prior,'ceilingFill')){
    // Full input admission establishes the unique canonical automatic fill.
    // Retain that emitter verbatim when retiring its legacy point prerequisite.
    const details=lightDetailsFor(next),fills=details.filter(binding=>binding.purpose==='room-supplemental-fill'&&next.lights.some(row=>same(row.id,binding.lightId)&&same(row.roomId,light.roomId)));
    if(fills.length>1)fail();
    if(fills.length===1){
     fills[0]!.purpose='room-base';
     writeBindings(next,LIGHT_DETAILS_NAMESPACE,details);
    }
   }
   if(settingsFor(next,light.id).trackAim){
    const value=furnishingsFor(next)!;value.bindings=value.bindings.filter(b=>b.hostKind!=='light'||!same(b.hostId,light.id));value.assets=value.assets.filter(a=>value.bindings.some(b=>same(b.assetId,a.id)));
    if(value.bindings.length)next.extensions![FURNISHING_NAMESPACE]=value as unknown as NonNullable<Exhibition['extensions']>[string];else delete next.extensions![FURNISHING_NAMESPACE];
   }else next=applyFurnishingCommand(next,{type:'remove-furnishing-visual',hostKind:'light',hostId:light.id});
   next.lights=next.lights.filter(v=>!same(v.id,light.id));
   for(const [namespace,bindings]of[[LIGHT_DETAILS_NAMESPACE,lightDetailsFor(next)],[LIGHT_ATTACHMENT_NAMESPACE,lightAttachmentsFor(next)]] as const)if(next.extensions?.[namespace]!==undefined)writeBindings(next,namespace,bindings.filter(v=>!same(v.lightId,light.id)));
   break;
  }
  default:return fail();
 }
 for(const asset of furnishingsFor(next)?.assets??[])if(!furnishingsFor(document)?.assets.some(a=>same(a.id,asset.id)))assertFreshId(document,asset.id);
 for(const asset of furnishingsFor(document)?.assets??[])if(!furnishingsFor(next)?.assets.some(a=>same(a.id,asset.id)))assertNoForeignReference(document,asset.id);
 // Existing helpers mark template.modified eagerly; restore that one flag
 // before semantic comparison so an explicit no-op preserves the entire source.
 const originalTemplate=document.extensions?.[TEMPLATE_NAMESPACE],changedTemplate=next.extensions?.[TEMPLATE_NAMESPACE];
 if(object(originalTemplate)&&object(changedTemplate)){if(Object.hasOwn(originalTemplate,'modified'))changedTemplate.modified=originalTemplate.modified!;else delete changedTemplate.modified;}
 assertDocument(next);
 if(freezeCanonical(next)===freezeCanonical(document))return {candidate:structuredClone(document),lightId};
 if(options.verifiedBaseline)assertRoomEnvelopeContentsAgainstBaseline(next,options.verifiedBaseline,light.roomId);else assertRoomEnvelopeContents(next,light.roomId);
 const template=next.extensions?.[TEMPLATE_NAMESPACE];if(object(template))template.modified=true;
 return {candidate:next,lightId};
}
