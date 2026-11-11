// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,validateArtifactPose} from './artifact-affine.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';
import {freezeCanonical} from './freeze.js';
import {benchesFor} from './benches.js';
import {applyFurnishingCommand,furnishingsFor,validateFurnishings,FURNISHING_NAMESPACE,SUPPORTED_FURNISHINGS,type FurnishingCatalogId,type FurnishingPose} from './furnishings.js';
import {lightDetailsFor,setLightDetails,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE,type ExhibitionLight,type LightDetails} from './light-details.js';
import {lightAttachmentsFor,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE,assertRoomEnvelopeContents,assertRoomEnvelopeContentsAgainstBaseline,type LightAttachment} from './room-envelope.js';

export type LightObjectCommand=
 |{type:'set-light-object';lightId:string;light:Omit<ExhibitionLight,'id'>;settings:Omit<LightDetails,'lightId'>;attachment?:Omit<LightAttachment,'lightId'>|null}
 |{type:'set-light-fixture';lightId:string;visual:null|{catalogId:FurnishingCatalogId;catalogVersion:1;pose:FurnishingPose}}
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
   if(Object.hasOwn(command,'attachment')){
    if(command.attachment===undefined||command.attachment!==null&&(!closed(command.attachment,['surfaceId','anchor','gap'])||Object.hasOwn(command.attachment,'lightId')))return fail();
    const bindings=lightAttachmentsFor(next),index=bindings.findIndex(v=>same(v.lightId,light.id));
    if(command.attachment===null){if(index>=0)bindings.splice(index,1);}else{const value={...structuredClone(command.attachment),lightId:light.id};if(index>=0)bindings[index]=value;else bindings.push(value);}
    if(next.extensions?.[LIGHT_ATTACHMENT_NAMESPACE]!==undefined||command.attachment!==null)writeBindings(next,LIGHT_ATTACHMENT_NAMESPACE,bindings);
   }
   break;
  }
  case 'set-light-fixture':{
   if(!closed(command,['type','lightId','visual']))fail();
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
   next=applyFurnishingCommand(next,{type:'remove-furnishing-visual',hostKind:'light',hostId:light.id});
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
