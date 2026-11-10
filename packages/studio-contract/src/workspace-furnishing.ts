// SPDX-License-Identifier: AGPL-3.0-or-later
import {qualifiedFrameTargetFit,qualifiedModularPortalTarget,qualifiedPortalWallFit,workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';
import type {WorkspaceFitProfile,WorkspaceFitReceipt} from './workspace-fit-receipt.js';
import {artworkFrameFit,artworkFrameModel} from '@exhibitos/spec/artwork-frame-models';
export {artworkFrameFit,artworkFrameModel} from '@exhibitos/spec/artwork-frame-models';
import {pairedPortalFit,portalFinishModel} from '@exhibitos/spec/portal-finish-models';
export {portalFinishModel} from '@exhibitos/spec/portal-finish-models';
/** Workspace-owned objects are separate from the fixed bundled catalogue.
 * A descriptor is metadata, not permission or proof of bytes or ownership. */
export const WORKSPACE_FURNISHING_NAMESPACE='org.exhibitos.studio/workspace-furnishings';
export type WorkspaceFurnishingKind='pedestal'|'bench'|'stool'|'partition'|'info-stand'|'barrier'|'display-case'|'artwork-frame'|'portal-finish';
export interface WorkspaceFurnishingModel {mime:'model/gltf-binary';bytes:number;sha256:string}
export interface WorkspaceFurnishingDescriptor {id:string;version:1;kind:WorkspaceFurnishingKind;name:string;rights:unknown;provenance:string;model:WorkspaceFurnishingModel;fit?:WorkspaceFitReceipt}
export const INFO_STAND_PREPARATION_POLICY='normalize-legacy-sign-texture-r1' as const;
export const INFO_STAND_PREPARATION_PROFILE='workspace-info-stand-preparation-v1' as const;
export type WorkspaceFurnishingPreparationPolicy='omit-unused-invalid-tangent-r1'|typeof INFO_STAND_PREPARATION_POLICY;
export interface WorkspaceFurnishingDeclaration extends Omit<WorkspaceFurnishingDescriptor,'id'|'version'|'fit'> {requestId:string;preparationPolicy?:WorkspaceFurnishingPreparationPolicy;fitProfile?:WorkspaceFitProfile}
export interface WorkspaceInfoStandPreparationReceipt {
 recipe:typeof INFO_STAND_PREPARATION_POLICY;
 sourceModel:WorkspaceFurnishingModel;
 renderableModel:WorkspaceFurnishingModel;
 runtimeManifestSHA256:string;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** The existing rights schema has no source-bound derivation grant for licensees.
 * Validate the full rights record and the current use separately. */
export function isDeclaredFurnishingPreparationOwner(rights:unknown):boolean {
 return object(rights)&&rights.ownership==='owner';
}
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
/** Structural checks only; the server must separately validate rights, live
 * workspace ownership and the complete GLB before registration or use. */
export function validWorkspaceFurnishingDeclaration(value:unknown,options:{allowStool?:boolean;allowRoomVisual?:boolean;allowArtworkFrame?:boolean;allowFramePreparation?:boolean;allowInfoStandPreparation?:boolean;allowPortalFinish?:boolean;allowReusableFit?:boolean}={}):value is WorkspaceFurnishingDeclaration{
 if(!object(value))return false;
 const fields=['requestId','kind','name','rights','provenance','model'];
 if(Object.hasOwn(value,'fitProfile')){
  if(!options.allowReusableFit||Object.hasOwn(value,'preparationPolicy')||
   !(value.kind==='artwork-frame'&&value.fitProfile==='straight-ring-v1'||value.kind==='portal-finish'&&(value.fitProfile==='continuous-portal-v1'||value.fitProfile==='modular-portal-v1')))return false;
  fields.push('fitProfile');
 }
 if(Object.hasOwn(value,'preparationPolicy')){
  const frame=value.preparationPolicy==='omit-unused-invalid-tangent-r1'&&value.kind==='artwork-frame'&&options.allowFramePreparation;
  const infoStand=value.preparationPolicy===INFO_STAND_PREPARATION_POLICY&&value.kind==='info-stand'&&options.allowInfoStandPreparation;
  if(!frame&&!infoStand)return false;
  fields.push('preparationPolicy');
 }
 if(!exact(value,fields)||!uuid(value.requestId)||typeof value.kind!=='string'||!['pedestal','bench',...(options.allowStool?['stool']:[]),...(options.allowRoomVisual?['partition','info-stand','barrier','display-case']:[]),...(options.allowArtworkFrame?['artwork-frame']:[]),...(options.allowPortalFinish?['portal-finish']:[])].includes(value.kind)||typeof value.name!=='string'||value.name.trim()!==value.name||value.name.length<1||value.name.length>120||typeof value.provenance!=='string'||value.provenance.trim()!==value.provenance||value.provenance.length<1||value.provenance.length>1024||!object(value.model))return false;
 const m=value.model;return exact(m,['mime','bytes','sha256'])&&m.mime==='model/gltf-binary'&&Number.isSafeInteger(m.bytes)&&Number(m.bytes)>0&&Number(m.bytes)<=32*1024*1024&&typeof m.sha256==='string'&&/^[a-f0-9]{64}$/.test(m.sha256);
}

/** A visual placement is room-local and does not assert seating, collision,
 * support or any other functional semantics of an unverified mesh. */
export interface WorkspaceFurnishingPlacement {id:string;roomId:string;furnishingId:string;furnishingVersion:1;position:[number,number,number];yaw:number;scale:number}
export interface WorkspaceFrameAttachment {placementId:string;artworkRevisionId:string;assetId:string;furnishingId:string;furnishingVersion:1;modelSha256:string}
export interface WorkspaceOpeningAttachment {openingId:string;furnishingId:string;furnishingVersion:1;modelSha256:string}
export interface WorkspaceFurnishings {version:1|2|3|4|5|6|7;furnishings:WorkspaceFurnishingDescriptor[];placements:WorkspaceFurnishingPlacement[];frameAttachments?:WorkspaceFrameAttachment[];openingAttachments?:WorkspaceOpeningAttachment[]}
/** Validate structural references only. Callers must bind each descriptor to
 * the issued workspace catalog and current rights before save or rendering. */
export function validateWorkspaceFurnishings(candidate:unknown):{valid:boolean;errors:{code:string;path:string}[]}{
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,WORKSPACE_FURNISHING_NAMESPACE))return {valid:true,errors:[]};
 const invalid=()=>({valid:false,errors:[{code:'WORKSPACE_FURNISHING_INVALID',path:'/extensions/org.exhibitos.studio~1workspace-furnishings'}]});
 const value=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE];
 if(!object(value)||typeof value.version!=='number'||![1,2,3,4,5,6,7].includes(value.version))return invalid();
 const version=value.version,hasFrames=version>=4,hasOpenings=version>=6;
 const fields=['version','furnishings','placements',...(hasFrames?['frameAttachments']:[]),...(hasOpenings?['openingAttachments']:[])];
 if(!exact(value,fields)||!Array.isArray(value.furnishings)||value.furnishings.length<1||value.furnishings.length>64||
  !Array.isArray(value.placements)||!hasFrames&&value.placements.length<1||value.placements.length>128||
  hasFrames&&(!Array.isArray(value.frameAttachments)||value.frameAttachments.length>128)||
  hasOpenings&&(!Array.isArray(value.openingAttachments)||version===6&&value.openingAttachments.length<1||value.openingAttachments.length>128)||!Array.isArray(candidate.rooms))return invalid();
 const rooms=new Map<string,Record<string,unknown>>();for(const room of candidate.rooms){if(!object(room)||!uuid(room.id)||rooms.has(room.id)||!object(room.dimensions))return invalid();rooms.set(room.id,room);}
 const items=new Map<string,WorkspaceFurnishingDescriptor>(),ids=new Set<string>();
 for(const collection of ['rooms','surfaces','openings','placements','lights','mediaAssets','artworks'])for(const entity of Array.isArray(candidate[collection])?candidate[collection] as unknown[]:[]){if(!object(entity))continue;for(const value of [entity.id,entity.revisionId,...(Array.isArray(entity.assets)?entity.assets.map(a=>object(a)?a.id:undefined):[])])if(typeof value==='string')ids.add(value.toLowerCase());}
 const fits=new Map<string,NonNullable<ReturnType<typeof workspaceFitGeometry>>>();
 for(const item of value.furnishings){
  if(!object(item))return invalid();
  const hasFit=Object.hasOwn(item,'fit'),geometry=hasFit?workspaceFitGeometry(item):undefined;
  if(hasFit&&(version!==7||!geometry)||
   !exact(item,['id','version','kind','name','rights','provenance','model',...(hasFit?['fit']:[])])||!uuid(item.id)||item.version!==1||
   !validWorkspaceFurnishingDeclaration({requestId:'10000000-0000-4000-8000-000000000001',kind:item.kind,name:item.name,rights:item.rights,provenance:item.provenance,model:item.model},
    {allowStool:version>=2,allowRoomVisual:version>=3,allowArtworkFrame:hasFrames,allowPortalFinish:hasOpenings})||items.has(item.id)||ids.has(item.id))return invalid();
  items.set(item.id,item as unknown as WorkspaceFurnishingDescriptor);ids.add(item.id);
  if(geometry)fits.set(item.id,geometry);
 }
 if(version===7&&!fits.size)return invalid();
 const used=new Set<string>();for(const placement of value.placements){if(!object(placement)||!exact(placement,['id','roomId','furnishingId','furnishingVersion','position','yaw','scale'])||!uuid(placement.id)||ids.has(placement.id)||!uuid(placement.roomId)||!uuid(placement.furnishingId)||placement.furnishingVersion!==1||!items.has(placement.furnishingId)||['artwork-frame','portal-finish'].includes(items.get(placement.furnishingId)?.kind??'')||!Array.isArray(placement.position)||placement.position.length!==3||!placement.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)||typeof placement.yaw!=='number'||!Number.isFinite(placement.yaw)||Math.abs(placement.yaw)>Math.PI||typeof placement.scale!=='number'||!Number.isFinite(placement.scale)||placement.scale<.1||placement.scale>4)return invalid();const room=rooms.get(placement.roomId),dimensions=room?.dimensions;if(!object(dimensions)||typeof dimensions.width!=='number'||typeof dimensions.depth!=='number'||typeof dimensions.height!=='number'||![dimensions.width,dimensions.height,dimensions.depth].every(n=>Number.isFinite(n)&&n>0)||Math.abs(placement.position[0])>dimensions.width/2||placement.position[1]<0||placement.position[1]>dimensions.height||Math.abs(placement.position[2])>dimensions.depth/2)return invalid();ids.add(placement.id);used.add(placement.furnishingId);}
 const openingSeen=new Set<string>();
 for(const attachment of Array.isArray(value.openingAttachments)?value.openingAttachments:[]){
  if(!object(attachment)||!exact(attachment,['openingId','furnishingId','furnishingVersion','modelSha256'])||!uuid(attachment.openingId)||!uuid(attachment.furnishingId)||attachment.furnishingVersion!==1||typeof attachment.modelSha256!=='string'||!/^[a-f0-9]{64}$/.test(attachment.modelSha256))return invalid();
  const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase(),opens=Array.isArray(candidate.openings)?candidate.openings.filter(o=>object(o)&&same(o.id,attachment.openingId)):[],opening=opens[0];
  const walls=Array.isArray(candidate.surfaces)?candidate.surfaces.filter(s=>object(s)&&object(opening)&&same(s.id,opening.surfaceId)):[],wall=walls[0],roomRows=candidate.rooms.filter(r=>object(r)&&object(wall)&&same(r.id,wall.roomId)),room=roomRows[0],source=items.get(attachment.furnishingId);
  const failPortal=(code:string)=>({valid:false,errors:[{code,path:'/extensions/org.exhibitos.studio~1workspace-furnishings/openingAttachments'}]});
  if(openingSeen.has(attachment.openingId)||opens.length!==1||!object(opening)||opening.type!=='door'||walls.length!==1||!object(wall)||wall.type!=='wall'||roomRows.length!==1||!object(room))return failPortal('PORTAL_TARGET_STALE');openingSeen.add(attachment.openingId);
  const fit=fits.get(attachment.furnishingId);
  const model=fit?.profile==='modular-portal-v1'&&object(opening.dimensions)?{width:opening.dimensions.width,height:opening.dimensions.height,paired:false}:fit?.profile==='continuous-portal-v1'?{width:fit.openingWidth,height:fit.openingHeight,paired:false}:source&&portalFinishModel(source.model.sha256,source.model.bytes);
  if(!source||source.kind!=='portal-finish'||!model||attachment.modelSha256!==source.model.sha256)return failPortal('PORTAL_ASSET_UNSUPPORTED');used.add(attachment.furnishingId);
  const d=opening.dimensions;if(!object(d)||typeof model.width!=='number'||typeof model.height!=='number'||typeof d.width!=='number'||typeof d.height!=='number'||![d.width,d.height].every(Number.isFinite)||Math.abs(d.width-model.width)>1e-6||Math.abs(d.height-model.height)>1e-6)return failPortal('PORTAL_SIZE_UNSUPPORTED');
  const level=(t:unknown)=>object(t)&&Array.isArray(t.scale)&&t.scale.length===3&&t.scale.every(n=>n===1)&&Array.isArray(t.rotation)&&t.rotation.length===4&&t.rotation.every(n=>typeof n==='number'&&Number.isFinite(n))&&t.rotation[0]===0&&t.rotation[2]===0&&Math.abs(t.rotation[1]**2+t.rotation[3]**2-1)<=1e-6;
  if(!level(wall.transform)||!level(room.transform)||!Array.isArray(opening.offset)||opening.offset.length!==2||!opening.offset.every(n=>typeof n==='number'&&Number.isFinite(n))||!object(wall.transform)||!Array.isArray(wall.transform.position)||wall.transform.position.length!==3||!wall.transform.position.every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(wall.transform.position[1]+opening.offset[1]-model.height/2)>1e-6)return failPortal('PORTAL_TRANSFORM_UNSUPPORTED');
  const architectural=candidate.extensions['org.exhibitos.studio/architectural-finishes'];let finish:{depth:number;preset:string}|undefined;
  if(architectural!==undefined){
   if(!object(architectural)||!exact(architectural,['version','walls'])||architectural.version!==1||!Array.isArray(architectural.walls)||architectural.walls.length>8)return failPortal('PORTAL_WALL_DEPTH_UNSUPPORTED');
   const seen=new Set<string>();for(const f of architectural.walls){if(!object(f)||!exact(f,['surfaceId','depth','preset','trimWidth','baseboardHeight','ceilingBand'])||typeof f.surfaceId!=='string'||!uuid(f.surfaceId.toLowerCase())||seen.has(f.surfaceId.toLowerCase())||typeof f.depth!=='number'||typeof f.trimWidth!=='number'||typeof f.baseboardHeight!=='number'||![f.depth,f.trimWidth,f.baseboardHeight].every(Number.isFinite)||f.depth<.02||f.depth>.2||f.trimWidth<.02||f.trimWidth>.08||f.baseboardHeight<.04||f.baseboardHeight>.15||!['plain','painted-edge','dark-edge'].includes(String(f.preset))||typeof f.ceilingBand!=='boolean')return failPortal('PORTAL_WALL_DEPTH_UNSUPPORTED');seen.add(f.surfaceId.toLowerCase());if(same(f.surfaceId,wall.id))finish={depth:f.depth,preset:String(f.preset)};}
  }
  if(fit?.profile==='modular-portal-v1'?!qualifiedModularPortalTarget(fit,candidate,attachment.openingId):fit?.profile==='continuous-portal-v1'? !qualifiedPortalWallFit(fit,opening,wall,finish,candidate.openings):model.paired? !pairedPortalFit(candidate,attachment.openingId):!!finish&&Math.abs(finish.depth-.2)>1e-6)return failPortal('PORTAL_WALL_DEPTH_UNSUPPORTED');
 }
 const attached=new Set<string>(),errors:{code:string;path:string}[]=[];
 const fail=(code:string,index:number)=>errors.push({code,path:`/extensions/org.exhibitos.studio~1workspace-furnishings/frameAttachments/${index}`});
 const placements=Array.isArray(candidate.placements)?candidate.placements:[],artworks=Array.isArray(candidate.artworks)?candidate.artworks:[];
 const extensions=object(candidate.extensions)?candidate.extensions:{};const installation=extensions['org.exhibitos.studio/installation'];
 for(const [i,a] of (Array.isArray(value.frameAttachments)?value.frameAttachments:[]).entries()){
  if(!object(a)||!exact(a,['placementId','artworkRevisionId','assetId','furnishingId','furnishingVersion','modelSha256'])||!uuid(a.placementId)||!uuid(a.artworkRevisionId)||!uuid(a.assetId)||!uuid(a.furnishingId)||a.furnishingVersion!==1||typeof a.modelSha256!=='string'||!/^[a-f0-9]{64}$/.test(a.modelSha256)){fail('FRAME_TARGET_STALE',i);continue;}
  const placement=placements.find(p=>object(p)&&p.id===a.placementId),art=artworks.find(p=>object(p)&&p.revisionId===a.artworkRevisionId),source=items.get(a.furnishingId);
  if(attached.has(a.placementId)||!object(placement)||!object(art)||placement.artworkRevisionId!==a.artworkRevisionId||placement.assetId!==a.assetId||art.primaryAssetId!==a.assetId){fail('FRAME_TARGET_STALE',i);continue;}attached.add(a.placementId);
  const fit=fits.get(a.furnishingId),qualified=fit?.profile==='straight-ring-v1'?fit:undefined;
  const frame=source&&artworkFrameModel(source.model.sha256,source.model.bytes);
  if(!source||source.kind!=='artwork-frame'||!frame&&!qualified||(value.version===4&&source.model.sha256!=='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4')||a.modelSha256!==source.model.sha256){fail('FRAME_ASSET_UNSUPPORTED',i);continue;}used.add(a.furnishingId);
  const dimensions=art.dimensions;if(art.artworkType!=='image'||art.schemaVersion!=='1.0.0-draft.1'||!object(dimensions)||typeof dimensions.width!=='number'||typeof dimensions.height!=='number'||!(qualified?qualifiedFrameTargetFit(qualified,dimensions.width,dimensions.height):frame&&artworkFrameFit(frame,dimensions.width,dimensions.height)))fail('FRAME_SIZE_UNSUPPORTED',i);
  if(object(dimensions)&&Object.hasOwn(dimensions,'depth'))fail('FRAME_DEPTH_UNSUPPORTED',i);
  const room=typeof placement.roomId==='string'?rooms.get(placement.roomId):undefined;
  if(![art.transform,placement.transform,room?.transform].every(t=>object(t)&&Array.isArray(t.scale)&&t.scale.length===3&&t.scale.every(n=>n===1)))fail('FRAME_TRANSFORM_UNSUPPORTED',i);
  if(object(installation)&&Array.isArray(installation.placements)&&installation.placements.some(b=>object(b)&&typeof b.placementId==='string'&&b.placementId.toLowerCase()===(a.placementId as string).toLowerCase()&&object(b.frame)&&b.frame.kind!=='none'))fail('FRAME_PROCEDURAL_CONFLICT',i);
 }
 if(errors.length)return {valid:false,errors};
 return used.size===items.size?{valid:true,errors:[]}:invalid();
}
