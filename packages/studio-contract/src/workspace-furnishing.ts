// SPDX-License-Identifier: AGPL-3.0-or-later
import {artworkFrameModel} from '@exhibitos/spec/artwork-frame-models';
export {artworkFrameModel} from '@exhibitos/spec/artwork-frame-models';
/** Workspace-owned objects are separate from the fixed bundled catalogue.
 * A descriptor is metadata, not permission or proof of bytes or ownership. */
export const WORKSPACE_FURNISHING_NAMESPACE='org.exhibitos.studio/workspace-furnishings';
export type WorkspaceFurnishingKind='pedestal'|'bench'|'stool'|'partition'|'info-stand'|'barrier'|'display-case'|'artwork-frame';
export interface WorkspaceFurnishingModel {mime:'model/gltf-binary';bytes:number;sha256:string}
export interface WorkspaceFurnishingDescriptor {id:string;version:1;kind:WorkspaceFurnishingKind;name:string;rights:unknown;provenance:string;model:WorkspaceFurnishingModel}
export interface WorkspaceFurnishingDeclaration extends Omit<WorkspaceFurnishingDescriptor,'id'|'version'> {requestId:string;preparationPolicy?:'omit-unused-invalid-tangent-r1'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
/** Structural checks only; the server must separately validate rights, live
 * workspace ownership and the complete GLB before registration or use. */
export function validWorkspaceFurnishingDeclaration(value:unknown,options:{allowStool?:boolean;allowRoomVisual?:boolean;allowArtworkFrame?:boolean;allowFramePreparation?:boolean}={}):value is WorkspaceFurnishingDeclaration{
 if(!object(value)||!exact(value,Object.hasOwn(value,'preparationPolicy')?['requestId','kind','name','rights','provenance','model','preparationPolicy']:['requestId','kind','name','rights','provenance','model'])||(Object.hasOwn(value,'preparationPolicy')&&(!options.allowFramePreparation||value.preparationPolicy!=='omit-unused-invalid-tangent-r1'||value.kind!=='artwork-frame'))||!uuid(value.requestId)||typeof value.kind!=='string'||!['pedestal','bench',...(options.allowStool?['stool']:[]),...(options.allowRoomVisual?['partition','info-stand','barrier','display-case']:[]),...(options.allowArtworkFrame?['artwork-frame']:[])].includes(value.kind)||typeof value.name!=='string'||value.name.trim()!==value.name||value.name.length<1||value.name.length>120||typeof value.provenance!=='string'||value.provenance.trim()!==value.provenance||value.provenance.length<1||value.provenance.length>1024||!object(value.model))return false;
 const m=value.model;return exact(m,['mime','bytes','sha256'])&&m.mime==='model/gltf-binary'&&Number.isSafeInteger(m.bytes)&&Number(m.bytes)>0&&Number(m.bytes)<=32*1024*1024&&typeof m.sha256==='string'&&/^[a-f0-9]{64}$/.test(m.sha256);
}

/** A visual placement is room-local and does not assert seating, collision,
 * support or any other functional semantics of an unverified mesh. */
export interface WorkspaceFurnishingPlacement {id:string;roomId:string;furnishingId:string;furnishingVersion:1;position:[number,number,number];yaw:number;scale:number}
export interface WorkspaceFrameAttachment {placementId:string;artworkRevisionId:string;assetId:string;furnishingId:string;furnishingVersion:1;modelSha256:string}
export interface WorkspaceFurnishings {version:1|2|3|4|5;furnishings:WorkspaceFurnishingDescriptor[];placements:WorkspaceFurnishingPlacement[];frameAttachments?:WorkspaceFrameAttachment[]}
/** Validate structural references only. Callers must bind each descriptor to
 * the issued workspace catalog and current rights before save or rendering. */
export function validateWorkspaceFurnishings(candidate:unknown):{valid:boolean;errors:{code:string;path:string}[]}{
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,WORKSPACE_FURNISHING_NAMESPACE))return {valid:true,errors:[]};
 const invalid=()=>({valid:false,errors:[{code:'WORKSPACE_FURNISHING_INVALID',path:'/extensions/org.exhibitos.studio~1workspace-furnishings'}]});
 const value=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE];if(!object(value)||!exact(value,(value.version===4||value.version===5)?['version','furnishings','placements','frameAttachments']:['version','furnishings','placements'])||(value.version!==1&&value.version!==2&&value.version!==3&&value.version!==4&&value.version!==5)||!Array.isArray(value.furnishings)||value.furnishings.length<1||value.furnishings.length>64||!Array.isArray(value.placements)||(value.version!==4&&value.version!==5&&value.placements.length<1)||value.placements.length>128||((value.version===4||value.version===5)&&(!Array.isArray(value.frameAttachments)||value.frameAttachments.length>128))||!Array.isArray(candidate.rooms))return invalid();
 const rooms=new Map<string,Record<string,unknown>>();for(const room of candidate.rooms){if(!object(room)||!uuid(room.id)||rooms.has(room.id)||!object(room.dimensions))return invalid();rooms.set(room.id,room);}
 const items=new Map<string,WorkspaceFurnishingDescriptor>(),ids=new Set<string>();
 for(const collection of ['rooms','surfaces','openings','placements','lights','mediaAssets','artworks'])for(const entity of Array.isArray(candidate[collection])?candidate[collection] as unknown[]:[]){if(!object(entity))continue;for(const value of [entity.id,entity.revisionId,...(Array.isArray(entity.assets)?entity.assets.map(a=>object(a)?a.id:undefined):[])])if(typeof value==='string')ids.add(value.toLowerCase());}
 for(const item of value.furnishings){if(!object(item)||!exact(item,['id','version','kind','name','rights','provenance','model'])||!uuid(item.id)||item.version!==1||!validWorkspaceFurnishingDeclaration({requestId:'10000000-0000-4000-8000-000000000001',kind:item.kind,name:item.name,rights:item.rights,provenance:item.provenance,model:item.model},{allowStool:value.version===2||value.version===3||value.version===4||value.version===5,allowRoomVisual:value.version===3||value.version===4||value.version===5,allowArtworkFrame:value.version===4||value.version===5})||items.has(item.id)||ids.has(item.id))return invalid();items.set(item.id,item as unknown as WorkspaceFurnishingDescriptor);ids.add(item.id);}
 const used=new Set<string>();for(const placement of value.placements){if(!object(placement)||!exact(placement,['id','roomId','furnishingId','furnishingVersion','position','yaw','scale'])||!uuid(placement.id)||ids.has(placement.id)||!uuid(placement.roomId)||!uuid(placement.furnishingId)||placement.furnishingVersion!==1||!items.has(placement.furnishingId)||items.get(placement.furnishingId)?.kind==='artwork-frame'||!Array.isArray(placement.position)||placement.position.length!==3||!placement.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)||typeof placement.yaw!=='number'||!Number.isFinite(placement.yaw)||Math.abs(placement.yaw)>Math.PI||typeof placement.scale!=='number'||!Number.isFinite(placement.scale)||placement.scale<.1||placement.scale>4)return invalid();const room=rooms.get(placement.roomId),dimensions=room?.dimensions;if(!object(dimensions)||typeof dimensions.width!=='number'||typeof dimensions.depth!=='number'||typeof dimensions.height!=='number'||![dimensions.width,dimensions.height,dimensions.depth].every(n=>Number.isFinite(n)&&n>0)||Math.abs(placement.position[0])>dimensions.width/2||placement.position[1]<0||placement.position[1]>dimensions.height||Math.abs(placement.position[2])>dimensions.depth/2)return invalid();ids.add(placement.id);used.add(placement.furnishingId);}
 const attached=new Set<string>(),errors:{code:string;path:string}[]=[];
 const fail=(code:string,index:number)=>errors.push({code,path:`/extensions/org.exhibitos.studio~1workspace-furnishings/frameAttachments/${index}`});
 const placements=Array.isArray(candidate.placements)?candidate.placements:[],artworks=Array.isArray(candidate.artworks)?candidate.artworks:[];
 const extensions=object(candidate.extensions)?candidate.extensions:{};const installation=extensions['org.exhibitos.studio/installation'];
 for(const [i,a] of (Array.isArray(value.frameAttachments)?value.frameAttachments:[]).entries()){
  if(!object(a)||!exact(a,['placementId','artworkRevisionId','assetId','furnishingId','furnishingVersion','modelSha256'])||!uuid(a.placementId)||!uuid(a.artworkRevisionId)||!uuid(a.assetId)||!uuid(a.furnishingId)||a.furnishingVersion!==1||typeof a.modelSha256!=='string'||!/^[a-f0-9]{64}$/.test(a.modelSha256)){fail('FRAME_TARGET_STALE',i);continue;}
  const placement=placements.find(p=>object(p)&&p.id===a.placementId),art=artworks.find(p=>object(p)&&p.revisionId===a.artworkRevisionId),source=items.get(a.furnishingId);
  if(attached.has(a.placementId)||!object(placement)||!object(art)||placement.artworkRevisionId!==a.artworkRevisionId||placement.assetId!==a.assetId||art.primaryAssetId!==a.assetId){fail('FRAME_TARGET_STALE',i);continue;}attached.add(a.placementId);
  if(!source||source.kind!=='artwork-frame'||(value.version===4?(source.model.sha256!=='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4'||source.model.bytes!==7892):!artworkFrameModel(source.model.sha256,source.model.bytes))||a.modelSha256!==source.model.sha256){fail('FRAME_ASSET_UNSUPPORTED',i);continue;}used.add(a.furnishingId);
  const dimensions=art.dimensions;if(art.artworkType!=='image'||art.schemaVersion!=='1.0.0-draft.1'||!object(dimensions)||typeof dimensions.width!=='number'||typeof dimensions.height!=='number'||!Number.isFinite(dimensions.width)||!Number.isFinite(dimensions.height)||Math.abs(dimensions.width-.6)>1e-6||Math.abs(dimensions.height-.8)>1e-6)fail('FRAME_SIZE_UNSUPPORTED',i);
  if(object(dimensions)&&Object.hasOwn(dimensions,'depth'))fail('FRAME_DEPTH_UNSUPPORTED',i);
  const room=typeof placement.roomId==='string'?rooms.get(placement.roomId):undefined;
  if(![art.transform,placement.transform,room?.transform].every(t=>object(t)&&Array.isArray(t.scale)&&t.scale.length===3&&t.scale.every(n=>n===1)))fail('FRAME_TRANSFORM_UNSUPPORTED',i);
  if(object(installation)&&Array.isArray(installation.placements)&&installation.placements.some(b=>object(b)&&typeof b.placementId==='string'&&b.placementId.toLowerCase()===(a.placementId as string).toLowerCase()&&object(b.frame)&&b.frame.kind!=='none'))fail('FRAME_PROCEDURAL_CONFLICT',i);
 }
 if(errors.length)return {valid:false,errors};
 return used.size===items.size?{valid:true,errors:[]}:invalid();
}
