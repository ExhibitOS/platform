// SPDX-License-Identifier: AGPL-3.0-or-later
export const PRESENCE_VERSION=1;
export const PRESENCE_ROOM_LIMIT=20;
export type PresenceErrorCode='PUBLICATION_UNAVAILABLE'|'REVISION_CHANGED'|'ROOM_FULL'|'JOIN_REQUIRED'|'PROTOCOL_INVALID'|'RATE_LIMITED'|'RESUME_INVALID'|'SESSION_EXPIRED'|'POSE_REJECTED'|'SERVER_BUSY';
export interface PresenceVisitor {visitorId:string;displayName:string;roomId:string;position:[number,number,number];yaw:number;connected:boolean}
export type PresenceClientMessage={version:1;type:'join';publicationId:string;revisionSha256:string;resumeToken?:string}|{version:1;type:'pose';seq:number;roomId:string;position:[number,number,number];yaw:number}|{version:1;type:'leave'}|{version:1;type:'ping';seq:number};
export interface PresenceSnapshot {version:1;type:'snapshot';publicationId:string;revisionSha256:string;selfId:string;serverTime:number;sequence:number;visitors:PresenceVisitor[]}
export type PresenceServerMessage=PresenceSnapshot|Omit<PresenceSnapshot,'type'>&{type:'welcome';resumeToken:string;resumeExpiresAt:number}|{version:1;type:'pong';seq:number;serverTime:number}|{version:1;type:'error';code:PresenceErrorCode};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fields=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const token=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const sequence=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
const time=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const position=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000);
const yaw=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=-Math.PI&&v<=Math.PI;
/** Validators receive deserialized JSON only. No identity/name field is accepted from a visitor. */
export function validatePresenceClientMessage(value:unknown):value is PresenceClientMessage {
 if(!object(value)||value.version!==1)return false;
 switch(value.type){
  case 'join':return fields(value,['version','type','publicationId','revisionSha256'],['resumeToken'])&&uuid(value.publicationId)&&hash(value.revisionSha256)&&(value.resumeToken===undefined||token(value.resumeToken));
  case 'pose':return fields(value,['version','type','seq','roomId','position','yaw'])&&sequence(value.seq)&&uuid(value.roomId)&&position(value.position)&&yaw(value.yaw);
  case 'leave':return fields(value,['version','type']);
  case 'ping':return fields(value,['version','type','seq'])&&sequence(value.seq);
  default:return false;
 }
}
const errors:PresenceErrorCode[]=['PUBLICATION_UNAVAILABLE','REVISION_CHANGED','ROOM_FULL','JOIN_REQUIRED','PROTOCOL_INVALID','RATE_LIMITED','RESUME_INVALID','SESSION_EXPIRED','POSE_REJECTED','SERVER_BUSY'];
export function validatePresenceServerMessage(value:unknown,publicationId:string,revisionSha256:string,roomIds:ReadonlySet<string>):value is PresenceServerMessage {
 if(!object(value)||value.version!==1)return false;
 if(value.type==='error')return fields(value,['version','type','code'])&&errors.includes(value.code as PresenceErrorCode);
 if(value.type==='pong')return fields(value,['version','type','seq','serverTime'])&&sequence(value.seq)&&time(value.serverTime);
 if(value.type!=='snapshot'&&value.type!=='welcome')return false;
 const ks=['version','type','publicationId','revisionSha256','selfId','serverTime','sequence','visitors'];if(value.type==='welcome')ks.push('resumeToken','resumeExpiresAt');
 if(!fields(value,ks)||value.publicationId!==publicationId||value.revisionSha256!==revisionSha256||!uuid(value.selfId)||!time(value.serverTime)||!sequence(value.sequence)||!Array.isArray(value.visitors)||value.visitors.length<1||value.visitors.length>PRESENCE_ROOM_LIMIT)return false;
 if(value.type==='welcome'&&(!token(value.resumeToken)||!time(value.resumeExpiresAt)||Number(value.resumeExpiresAt)<Number(value.serverTime)))return false;
 const ids=new Set<string>();for(const v of value.visitors){if(!object(v)||!fields(v,['visitorId','displayName','roomId','position','yaw','connected'])||!uuid(v.visitorId)||ids.has(v.visitorId)||typeof v.displayName!=='string'||!/^Visitor [A-Z0-9]{6}$/.test(v.displayName)||!roomIds.has(String(v.roomId))||!position(v.position)||!yaw(v.yaw)||typeof v.connected!=='boolean')return false;ids.add(v.visitorId);}
 return ids.has(value.selfId);
}
