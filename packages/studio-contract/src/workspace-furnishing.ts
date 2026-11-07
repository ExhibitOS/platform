// SPDX-License-Identifier: AGPL-3.0-or-later
/** Workspace-owned objects are separate from the fixed bundled catalogue.
 * A descriptor is metadata, not permission or proof of bytes or ownership. */
export const WORKSPACE_FURNISHING_NAMESPACE='org.exhibitos.studio/workspace-furnishings';
export type WorkspaceFurnishingKind='pedestal'|'bench'|'stool'|'partition'|'info-stand'|'barrier'|'display-case';
export interface WorkspaceFurnishingModel {mime:'model/gltf-binary';bytes:number;sha256:string}
export interface WorkspaceFurnishingDescriptor {id:string;version:1;kind:WorkspaceFurnishingKind;name:string;rights:unknown;provenance:string;model:WorkspaceFurnishingModel}
export interface WorkspaceFurnishingDeclaration extends Omit<WorkspaceFurnishingDescriptor,'id'|'version'> {requestId:string}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
/** Structural checks only; the server must separately validate rights, live
 * workspace ownership and the complete GLB before registration or use. */
export function validWorkspaceFurnishingDeclaration(value:unknown,options:{allowStool?:boolean;allowRoomVisual?:boolean}={}):value is WorkspaceFurnishingDeclaration{
 if(!object(value)||!exact(value,['requestId','kind','name','rights','provenance','model'])||!uuid(value.requestId)||typeof value.kind!=='string'||!['pedestal','bench',...(options.allowStool?['stool']:[]),...(options.allowRoomVisual?['partition','info-stand','barrier','display-case']:[])].includes(value.kind)||typeof value.name!=='string'||value.name.trim()!==value.name||value.name.length<1||value.name.length>120||typeof value.provenance!=='string'||value.provenance.trim()!==value.provenance||value.provenance.length<1||value.provenance.length>1024||!object(value.model))return false;
 const m=value.model;return exact(m,['mime','bytes','sha256'])&&m.mime==='model/gltf-binary'&&Number.isSafeInteger(m.bytes)&&Number(m.bytes)>0&&Number(m.bytes)<=32*1024*1024&&typeof m.sha256==='string'&&/^[a-f0-9]{64}$/.test(m.sha256);
}

/** A visual placement is room-local and does not assert seating, collision,
 * support or any other functional semantics of an unverified mesh. */
export interface WorkspaceFurnishingPlacement {id:string;roomId:string;furnishingId:string;furnishingVersion:1;position:[number,number,number];yaw:number;scale:number}
export interface WorkspaceFurnishings {version:1|2|3;furnishings:WorkspaceFurnishingDescriptor[];placements:WorkspaceFurnishingPlacement[]}
/** Validate structural references only. Callers must bind each descriptor to
 * the issued workspace catalog and current rights before save or rendering. */
export function validateWorkspaceFurnishings(candidate:unknown):{valid:boolean;errors:{code:string;path:string}[]}{
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,WORKSPACE_FURNISHING_NAMESPACE))return {valid:true,errors:[]};
 const invalid=()=>({valid:false,errors:[{code:'WORKSPACE_FURNISHING_INVALID',path:'/extensions/org.exhibitos.studio~1workspace-furnishings'}]});
 const value=candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE];if(!object(value)||!exact(value,['version','furnishings','placements'])||(value.version!==1&&value.version!==2&&value.version!==3)||!Array.isArray(value.furnishings)||value.furnishings.length<1||value.furnishings.length>64||!Array.isArray(value.placements)||value.placements.length<1||value.placements.length>128||!Array.isArray(candidate.rooms))return invalid();
 const rooms=new Map<string,Record<string,unknown>>();for(const room of candidate.rooms){if(!object(room)||!uuid(room.id)||rooms.has(room.id)||!object(room.dimensions))return invalid();rooms.set(room.id,room);}
 const items=new Map<string,WorkspaceFurnishingDescriptor>(),ids=new Set<string>();
 for(const collection of ['rooms','surfaces','openings','placements','lights','mediaAssets','artworks'])for(const entity of Array.isArray(candidate[collection])?candidate[collection] as unknown[]:[]){if(!object(entity))continue;for(const value of [entity.id,entity.revisionId,...(Array.isArray(entity.assets)?entity.assets.map(a=>object(a)?a.id:undefined):[])])if(typeof value==='string')ids.add(value.toLowerCase());}
 for(const item of value.furnishings){if(!object(item)||!exact(item,['id','version','kind','name','rights','provenance','model'])||!uuid(item.id)||item.version!==1||!validWorkspaceFurnishingDeclaration({requestId:'10000000-0000-4000-8000-000000000001',kind:item.kind,name:item.name,rights:item.rights,provenance:item.provenance,model:item.model},{allowStool:value.version===2||value.version===3,allowRoomVisual:value.version===3})||items.has(item.id)||ids.has(item.id))return invalid();items.set(item.id,item as unknown as WorkspaceFurnishingDescriptor);ids.add(item.id);}
 const used=new Set<string>();for(const placement of value.placements){if(!object(placement)||!exact(placement,['id','roomId','furnishingId','furnishingVersion','position','yaw','scale'])||!uuid(placement.id)||ids.has(placement.id)||!uuid(placement.roomId)||!uuid(placement.furnishingId)||placement.furnishingVersion!==1||!items.has(placement.furnishingId)||!Array.isArray(placement.position)||placement.position.length!==3||!placement.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)||typeof placement.yaw!=='number'||!Number.isFinite(placement.yaw)||Math.abs(placement.yaw)>Math.PI||typeof placement.scale!=='number'||!Number.isFinite(placement.scale)||placement.scale<.1||placement.scale>4)return invalid();const room=rooms.get(placement.roomId),dimensions=room?.dimensions;if(!object(dimensions)||typeof dimensions.width!=='number'||typeof dimensions.depth!=='number'||typeof dimensions.height!=='number'||![dimensions.width,dimensions.height,dimensions.depth].every(n=>Number.isFinite(n)&&n>0)||Math.abs(placement.position[0])>dimensions.width/2||placement.position[1]<0||placement.position[1]>dimensions.height||Math.abs(placement.position[2])>dimensions.depth/2)return invalid();ids.add(placement.id);used.add(placement.furnishingId);}
 return used.size===items.size?{valid:true,errors:[]}:invalid();
}
