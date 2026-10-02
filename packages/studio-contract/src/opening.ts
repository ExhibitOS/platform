// SPDX-License-Identifier: AGPL-3.0-or-later
export type OpeningErrorCode='PUBLICATION_UNAVAILABLE'|'REVISION_CHANGED'|'ROOM_FULL'|'JOIN_REQUIRED'|'PROTOCOL_INVALID'|'RATE_LIMITED'|'RESUME_INVALID'|'SESSION_EXPIRED'|'SERVER_BUSY'|'HOST_REQUIRED'|'HOST_GRANT_INVALID'|'VOICE_FULL'|'CONSENT_REQUIRED'|'TARGET_UNAVAILABLE'|'VIEWPOINT_INVALID'|'SESSION_ENDED';
export interface OpeningParticipant {id:string;name:string;host:boolean;chat:boolean;voice:boolean;follow:boolean;muted:boolean;connected:boolean}
export interface OpeningChat {id:string;participantId:string;name:string;text:string;at:number}
export interface OpeningReport {id:string;reporterId:string;targetId:string;reason:'spam'|'abuse'|'other';note:string;at:number}
export type OpeningDescription={type:'offer'|'answer';sdp:string};
export interface OpeningCandidate {candidate:string;sdpMid:string|null;sdpMLineIndex:number|null}
export type OpeningSignalPayload={description:OpeningDescription;candidate?:never}|{candidate:OpeningCandidate;description?:never};
export type OpeningClientMessage={version:1;type:'join';publicationId:string;revisionSha256:string;resumeToken?:string;hostGrant?:string}|{version:1;type:'preferences';chat:boolean;voice:boolean;follow:boolean}|{version:1;type:'chat';text:string}|({version:1;type:'signal';targetId:string}&OpeningSignalPayload)|{version:1;type:'block';targetId:string}|{version:1;type:'report';targetId:string;reason:'spam'|'abuse'|'other';note:string}|{version:1;type:'host';command:'begin'|'end'|'mute_all'}|{version:1;type:'host';command:'guide'|'meet';viewpointId:string}|{version:1;type:'host';command:'mute'|'remove';targetId:string}|{version:1;type:'leave'}|{version:1;type:'ping';seq:number};
export interface OpeningSnapshot {version:1;type:'snapshot';publicationId:string;revisionSha256:string;selfId:string;serverTime:number;sequence:number;phase:'waiting'|'live'|'ended';participants:OpeningParticipant[];guide:null|{id:string;sequence:number;kind:'guide'|'meet'};messages:OpeningChat[];reports:OpeningReport[];blockedIds:string[]}
export type OpeningServerMessage=OpeningSnapshot|(Omit<OpeningSnapshot,'type'>&{type:'welcome';resumeToken:string;resumeExpiresAt:number})|({version:1;type:'signal';fromId:string}&OpeningSignalPayload)|{version:1;type:'pong';seq:number;serverTime:number}|{version:1;type:'error';code:OpeningErrorCode};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fields=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const token=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const text=(v:unknown,max:number,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&![...v].some(c=>{const n=c.charCodeAt(0);return n<32&&![9,10,13].includes(n)||n===127;});
const seq=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
const time=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const reason=(v:unknown)=>['spam','abuse','other'].includes(String(v));
function payload(v:Record<string,unknown>){
 if(v.description!==undefined){const d=v.description;return v.candidate===undefined&&obj(d)&&fields(d,['type','sdp'])&&['offer','answer'].includes(String(d.type))&&text(d.sdp,16384)&&new TextEncoder().encode(d.sdp as string).length<=16384;}
 const c=v.candidate;return obj(c)&&fields(c,['candidate','sdpMid','sdpMLineIndex'])&&text(c.candidate,2048,true)&&new TextEncoder().encode(c.candidate as string).length<=2048&&(c.sdpMid===null||text(c.sdpMid,64,true))&&(c.sdpMLineIndex===null||typeof c.sdpMLineIndex==='number'&&Number.isInteger(c.sdpMLineIndex)&&c.sdpMLineIndex>=0&&c.sdpMLineIndex<=255);
}
/** Closed, bounded deserialized-JSON signaling contract. No role, identity or arbitrary camera is accepted. */
export function validateOpeningClientMessage(v:unknown):v is OpeningClientMessage{
 if(!obj(v)||v.version!==1)return false;const base=['version','type'];
 switch(v.type){
 case 'join':return fields(v,[...base,'publicationId','revisionSha256'],['resumeToken','hostGrant'])&&uuid(v.publicationId)&&typeof v.revisionSha256==='string'&&/^[a-f0-9]{64}$/.test(v.revisionSha256)&&(v.resumeToken===undefined||token(v.resumeToken))&&(v.hostGrant===undefined||token(v.hostGrant))&&!(v.resumeToken&&v.hostGrant);
 case 'preferences':return fields(v,[...base,'chat','voice','follow'])&&['chat','voice','follow'].every(k=>typeof v[k]==='boolean');
 case 'chat':return fields(v,[...base,'text'])&&text(v.text,240);
 case 'signal':return fields(v,[...base,'targetId'],['description','candidate'])&&uuid(v.targetId)&&payload(v);
 case 'block':return fields(v,[...base,'targetId'])&&uuid(v.targetId);
 case 'report':return fields(v,[...base,'targetId','reason','note'])&&uuid(v.targetId)&&reason(v.reason)&&text(v.note,240,true);
 case 'host':if(['begin','end','mute_all'].includes(String(v.command)))return fields(v,[...base,'command']);if(['guide','meet'].includes(String(v.command)))return fields(v,[...base,'command','viewpointId'])&&uuid(v.viewpointId);return ['mute','remove'].includes(String(v.command))&&fields(v,[...base,'command','targetId'])&&uuid(v.targetId);
 case 'leave':return fields(v,base);
 case 'ping':return fields(v,[...base,'seq'])&&seq(v.seq);
 default:return false;
 }
}
const errors:OpeningErrorCode[]=['PUBLICATION_UNAVAILABLE','REVISION_CHANGED','ROOM_FULL','JOIN_REQUIRED','PROTOCOL_INVALID','RATE_LIMITED','RESUME_INVALID','SESSION_EXPIRED','SERVER_BUSY','HOST_REQUIRED','HOST_GRANT_INVALID','VOICE_FULL','CONSENT_REQUIRED','TARGET_UNAVAILABLE','VIEWPOINT_INVALID','SESSION_ENDED'];
export function validateOpeningServerMessage(v:unknown,publicationId:string,revision:string,viewpointIds:ReadonlySet<string>):v is OpeningServerMessage{
 if(!obj(v)||v.version!==1)return false;const base=['version','type'];
 if(v.type==='error')return fields(v,[...base,'code'])&&errors.includes(v.code as OpeningErrorCode);
 if(v.type==='pong')return fields(v,[...base,'seq','serverTime'])&&seq(v.seq)&&time(v.serverTime);
 if(v.type==='signal')return fields(v,[...base,'fromId'],['description','candidate'])&&uuid(v.fromId)&&payload(v);
 if(v.type!=='welcome'&&v.type!=='snapshot')return false;
 const keys=[...base,'publicationId','revisionSha256','selfId','serverTime','sequence','phase','participants','guide','messages','reports','blockedIds'];if(v.type==='welcome')keys.push('resumeToken','resumeExpiresAt');
 if(!fields(v,keys)||v.publicationId!==publicationId||v.revisionSha256!==revision||!uuid(v.selfId)||!time(v.serverTime)||!seq(v.sequence)||!['waiting','live','ended'].includes(String(v.phase))||!Array.isArray(v.participants)||v.participants.length<1||v.participants.length>20||!Array.isArray(v.messages)||v.messages.length>30||!Array.isArray(v.reports)||v.reports.length>20)return false;
 if(!Array.isArray(v.blockedIds)||v.blockedIds.length>20||!v.blockedIds.every(uuid)||new Set(v.blockedIds).size!==v.blockedIds.length)return false;
 if(v.type==='welcome'&&(!token(v.resumeToken)||!time(v.resumeExpiresAt)||Number(v.resumeExpiresAt)<Number(v.serverTime)))return false;
 const ids=new Set<string>();let hosts=0,voices=0;for(const p of v.participants){if(!obj(p)||!fields(p,['id','name','host','chat','voice','follow','muted','connected'])||!uuid(p.id)||ids.has(p.id)||typeof p.name!=='string'||!/^Visitor [A-Z0-9]{6}$/.test(p.name)||!['host','chat','voice','follow','muted','connected'].every(k=>typeof p[k]==='boolean')||p.muted&&p.voice)return false;ids.add(p.id);if(p.host)hosts++;if(p.voice)voices++;}
 if(!ids.has(v.selfId)||hosts>1||voices>6)return false;
 if(v.guide!==null&&(!obj(v.guide)||!fields(v.guide,['id','sequence','kind'])||!viewpointIds.has(String(v.guide.id))||!seq(v.guide.sequence)||!['guide','meet'].includes(String(v.guide.kind))))return false;
 for(const m of v.messages)if(!obj(m)||!fields(m,['id','participantId','name','text','at'])||!uuid(m.id)||!uuid(m.participantId)||typeof m.name!=='string'||!/^Visitor [A-Z0-9]{6}$/.test(m.name)||!text(m.text,240)||!time(m.at))return false;
 const self=v.participants.find(p=>p.id===v.selfId);if(!self.host&&v.reports.length)return false;
 for(const r of v.reports)if(!obj(r)||!fields(r,['id','reporterId','targetId','reason','note','at'])||!uuid(r.id)||!uuid(r.reporterId)||!uuid(r.targetId)||!reason(r.reason)||!text(r.note,240,true)||!time(r.at))return false;
 return true;
}
