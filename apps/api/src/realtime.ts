// SPDX-License-Identifier: AGPL-3.0-or-later
import type {FastifyInstance} from 'fastify';
import {WebSocketServer,WebSocket} from 'ws';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Duplex} from 'node:stream';
import type {Exhibition} from '@exhibitos/spec';
import {validateExhibition} from '@exhibitos/spec';
import {validatePresenceClientMessage,type PresenceClientMessage,type PresenceVisitor,type PresenceErrorCode} from '@exhibitos/studio-contract';
import {createPresenceGeometry,type PresencePose} from './realtime-geometry.ts';
export interface RealtimePublication {exhibition:Exhibition;publication:{id:string;revisionSha256:string;status:string}}
export interface RealtimeSettings {origin:string;publication(id:string):Promise<RealtimePublication>;maxBufferedBytes?:number}
interface Visitor {state:PresenceVisitor;socket?:WebSocket;tokenHash:string;expires:number;reservedUntil:number;lastPose:number;poseSeq:number;credit:number}
interface Room {id:string;revision:string;visitors:Map<string,Visitor>;geometry:ReturnType<typeof createPresenceGeometry>;sequence:number;checkedAt:number;checking?:Promise<boolean>;closed:boolean}
interface Context {socket:WebSocket;publicationId:string;room?:Room;visitor?:Visitor;alive:boolean;busy:boolean;queue:Array<{bytes:Buffer;isBinary:boolean}>;joined:boolean;joinTimer:ReturnType<typeof setTimeout>;tokens:number;tokenAt:number;poseTokens:number;poseAt:number;pongAt:number}
export interface RealtimeMetrics {connections:number;rooms:number;visitors:number;peakConnections:number;peakVisitors:number;joins:number;acceptedPoses:number;rejectedPoses:number;receivedBytes:number;sentBytes:number;snapshots:number;policyChecks:number;policyFailures:number;backpressureDisconnects:number}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const maxSession=1800000,reservation=30000,policyAge=2000,frameBytes=2048;
/** A single-process ephemeral presence service. Current public rights remain the existing anonymous API's authority. */
export function registerRealtime(app:FastifyInstance,settings:RealtimeSettings){
 const origin=new URL(settings.origin);if(origin.origin!==settings.origin||!['http:','https:'].includes(origin.protocol))throw Error('Exact realtime origin required');
 const maxBuffer=settings.maxBufferedBytes??65536;if(!Number.isInteger(maxBuffer)||maxBuffer<2048||maxBuffer>131072)throw Error('Invalid presence send budget');
 const rooms=new Map<string,Room>(),contexts=new Set<Context>(),checks=new Map<string,Promise<RealtimePublication>>(),ipBudgets=new Map<string,{tokens:number;at:number}>();
 const stats:RealtimeMetrics={connections:0,rooms:0,visitors:0,peakConnections:0,peakVisitors:0,joins:0,acceptedPoses:0,rejectedPoses:0,receivedBytes:0,sentBytes:0,snapshots:0,policyChecks:0,policyFailures:0,backpressureDisconnects:0};
 const wss=new WebSocketServer({noServer:true,maxPayload:frameBytes,perMessageDeflate:false});let stopping=false,lastPing=Date.now();
 const counts=()=>{stats.connections=contexts.size;stats.rooms=rooms.size;stats.visitors=[...rooms.values()].reduce((n,r)=>n+r.visitors.size,0);stats.peakConnections=Math.max(stats.peakConnections,stats.connections);stats.peakVisitors=Math.max(stats.peakVisitors,stats.visitors);};
 function send(socket:WebSocket,message:unknown){
  if(socket.readyState!==WebSocket.OPEN)return false;
  const text=JSON.stringify(message),bytes=Buffer.byteLength(text);
  if(socket.bufferedAmount+bytes>maxBuffer){stats.backpressureDisconnects++;socket.terminate();return false;}
  try{socket.send(text,error=>{if(error)socket.terminate();});stats.sentBytes+=bytes;return true;}catch{socket.terminate();return false;}
 }
 function error(context:Context,code:PresenceErrorCode,close=true){send(context.socket,{version:1,type:'error',code});if(close)context.socket.close(1008);}
 function remove(room:Room,visitor:Visitor){room.visitors.delete(visitor.state.visitorId);counts();}
 function discard(room:Room,code:PresenceErrorCode){if(room.closed)return;room.closed=true;rooms.delete(room.id);for(const c of contexts)if(c.room===room){error(c,code);c.visitor=undefined;c.room=undefined;}room.visitors.clear();counts();}
 function close(context:Context){if(!context.alive)return;context.alive=false;clearTimeout(context.joinTimer);contexts.delete(context);const {visitor,room}=context;if(visitor&&room&&!room.closed&&visitor.socket===context.socket){visitor.socket=undefined;visitor.state.connected=false;visitor.reservedUntil=Math.min(Date.now()+reservation,visitor.expires);}counts();}
 async function publication(id:string):Promise<RealtimePublication>{
  let pending=checks.get(id);
  if(!pending){if(checks.size>=4)throw Error('publication budget');stats.policyChecks++;pending=settings.publication(id).then(result=>{if(result.publication.id!==id||result.publication.status!=='published'||!/^[a-f0-9]{64}$/.test(result.publication.revisionSha256)||!validateExhibition(result.exhibition).valid)throw Error('Unavailable publication');return result;});checks.set(id,pending);void pending.finally(()=>{if(checks.get(id)===pending)checks.delete(id);}).catch(()=>{});}
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([pending,new Promise<never>((_r,reject)=>{timeout=setTimeout(()=>reject(Error('publication timeout')),3000);})]);}finally{clearTimeout(timeout);}
 }
 async function current(room:Room){
  if(room.closed)return false;if(Date.now()-room.checkedAt<policyAge)return true;
  if(!room.checking)room.checking=publication(room.id).then(result=>{if(room.closed)return false;if(result.publication.revisionSha256!==room.revision){discard(room,'REVISION_CHANGED');return false;}room.checkedAt=Date.now();return true;}).catch(()=>{stats.policyFailures++;discard(room,'PUBLICATION_UNAVAILABLE');return false;}).finally(()=>{room.checking=undefined;});
  return room.checking;
 }
 function snapshot(room:Room,visitor:Visitor,type:'snapshot'|'welcome',token?:string){const common={version:1,type,publicationId:room.id,revisionSha256:room.revision,selfId:visitor.state.visitorId,serverTime:Date.now(),sequence:room.sequence,visitors:[...room.visitors.values()].map(v=>v.state)};return type==='welcome'?{...common,resumeToken:token,resumeExpiresAt:visitor.expires}:common;}
 async function join(c:Context,message:Extract<PresenceClientMessage,{type:'join'}>){
  if(c.joined){error(c,'PROTOCOL_INVALID');return;}c.joined=true;
  if(message.publicationId!==c.publicationId){error(c,'PROTOCOL_INVALID');return;}
  let result:RealtimePublication;try{result=await publication(c.publicationId);}catch{if(c.alive)error(c,'PUBLICATION_UNAVAILABLE');return;}
  if(!c.alive||c.socket.readyState!==WebSocket.OPEN)return;
  if(result.publication.revisionSha256!==message.revisionSha256){error(c,'REVISION_CHANGED');return;}
  let room=rooms.get(c.publicationId);
  if(room&&room.revision!==message.revisionSha256){discard(room,'REVISION_CHANGED');room=undefined;}
  if(!room){if(rooms.size>=16){error(c,'SERVER_BUSY');return;}room={id:c.publicationId,revision:message.revisionSha256,visitors:new Map(),geometry:createPresenceGeometry(result.exhibition),sequence:0,checkedAt:Date.now(),closed:false};rooms.set(room.id,room);}
  room.checkedAt=Date.now();let visitor:Visitor|undefined;
  if(message.resumeToken){const digest=hash(message.resumeToken);visitor=[...room.visitors.values()].find(v=>v.tokenHash===digest);if(!visitor||visitor.expires<=Date.now()||(!visitor.state.connected&&visitor.reservedUntil<=Date.now())){error(c,'RESUME_INVALID');return;}const prior=visitor.socket;if(prior&&prior!==c.socket)prior.terminate();}
  else {
   if(room.visitors.size>=20){error(c,'ROOM_FULL');return;}const pose=room.geometry.spawn();if(!pose){error(c,'POSE_REJECTED');return;}
   const visitorId=randomUUID();visitor={state:{visitorId,displayName:'Visitor '+randomBytes(3).toString('hex').toUpperCase(),...pose,connected:true},tokenHash:'',expires:Date.now()+maxSession,reservedUntil:0,lastPose:Date.now(),poseSeq:-1,credit:.25};room.visitors.set(visitorId,visitor);
  }
  const token=randomBytes(32).toString('base64url');visitor.tokenHash=hash(token);visitor.socket=c.socket;visitor.state.connected=true;visitor.reservedUntil=0;visitor.lastPose=Date.now();visitor.poseSeq=-1;visitor.credit=.25;c.room=room;c.visitor=visitor;clearTimeout(c.joinTimer);stats.joins++;counts();send(c.socket,snapshot(room,visitor,'welcome',token));
 }
 function budget(c:Context,pose:boolean){const now=Date.now();c.tokens=Math.min(30,c.tokens+(now-c.tokenAt)*25/1000);c.tokenAt=now;if(c.tokens<1)return false;c.tokens--;if(pose){c.poseTokens=Math.min(12,c.poseTokens+(now-c.poseAt)*10/1000);c.poseAt=now;if(c.poseTokens<1)return false;c.poseTokens--;}return true;}
 async function handle(c:Context,data:Buffer,isBinary:boolean){
  if(!c.alive)return;stats.receivedBytes+=data.length;if(isBinary||data.length>frameBytes){error(c,'PROTOCOL_INVALID');return;}
  let message:unknown;try{message=JSON.parse(data.toString('utf8'));}catch{error(c,'PROTOCOL_INVALID');return;}
  if(!validatePresenceClientMessage(message)){error(c,'PROTOCOL_INVALID');return;}
  if(!budget(c,message.type==='pose')){error(c,'RATE_LIMITED');return;}
  if(message.type==='join'){await join(c,message);return;}
  const {room,visitor}=c;if(!room||!visitor){error(c,'JOIN_REQUIRED');return;}
  if(visitor.expires<=Date.now()){remove(room,visitor);c.visitor=undefined;error(c,'SESSION_EXPIRED');return;}
  if(message.type==='leave'){remove(room,visitor);c.visitor=undefined;c.socket.close(1000);return;}
  if(!await current(room)||!c.alive||visitor.socket!==c.socket||room.closed)return;
  if(message.type==='ping'){send(c.socket,{version:1,type:'pong',seq:message.seq,serverTime:Date.now()});return;}
  if(message.type==='pose'){
   const next:PresencePose={roomId:message.roomId,position:message.position,yaw:message.yaw};const now=Date.now(),elapsed=now-visitor.lastPose;
   const credit=Math.min(1,visitor.credit+elapsed*2/1000),distance=Math.hypot(...next.position.map((n,i)=>n-visitor.state.position[i]!));
   if(message.seq<=visitor.poseSeq||distance>credit||!room.geometry.move(visitor.state,next,elapsed)){stats.rejectedPoses++;error(c,'POSE_REJECTED',false);return;}
   visitor.state={...visitor.state,...next};visitor.poseSeq=message.seq;visitor.lastPose=now;visitor.credit=credit-distance;stats.acceptedPoses++;
  }
 }
 function accept(socket:WebSocket,id:string){
  const c:Context={socket,publicationId:id,alive:true,busy:false,queue:[],joined:false,joinTimer:setTimeout(()=>error(c,'JOIN_REQUIRED'),5000),tokens:30,tokenAt:Date.now(),poseTokens:12,poseAt:Date.now(),pongAt:Date.now()};contexts.add(c);counts();socket.on('pong',()=>{c.pongAt=Date.now();});socket.on('error',()=>{});socket.on('close',()=>close(c));socket.on('message',(raw,isBinary)=>{
   const bytes=Buffer.isBuffer(raw)?raw:Array.isArray(raw)?Buffer.concat(raw):Buffer.from(raw);
   if(c.queue.length>=8||bytes.length>frameBytes){error(c,'RATE_LIMITED');return;}c.queue.push({bytes,isBinary});
   if(c.busy)return;c.busy=true;void (async()=>{while(c.alive&&c.queue.length){const item=c.queue.shift()!;await handle(c,item.bytes,item.isBinary);}})().catch(()=>{if(c.alive)error(c,'SERVER_BUSY');}).finally(()=>{c.busy=false;c.queue.length=0;});
  });
 }
 const upgrade:Parameters<typeof app.server.on>[1]=(request:import('node:http').IncomingMessage,socket:Duplex,head:Buffer)=>{
  const reject=(status:number)=>{socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
  const match=/^\/api\/v1\/publications\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/presence$/.exec(request.url??'');
  if(stopping||contexts.size>=200){reject(503);return;}
  if(!match||request.headers.origin!==settings.origin||request.headers.host!==origin.host||request.headers['sec-websocket-protocol']){reject(403);return;}
  const ip=request.socket.remoteAddress??'';const now=Date.now();for(const [key,b]of ipBudgets)if(now-b.at>60000)ipBudgets.delete(key);
  let b=ipBudgets.get(ip);if(!b){if(ipBudgets.size>=256){reject(503);return;}b={tokens:60,at:now};ipBudgets.set(ip,b);}b.tokens=Math.min(60,b.tokens+(now-b.at)/1000);b.at=now;if(b.tokens<1){reject(429);return;}b.tokens--;
  socket.on('error',()=>{});wss.handleUpgrade(request,socket,head,ws=>accept(ws,match[1]!));
 };
 app.server.on('upgrade',upgrade);
 const timer=setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values()){
   for(const v of room.visitors.values())if(v.expires<=now||!v.state.connected&&v.reservedUntil<=now){if(v.socket)v.socket.close(1008);remove(room,v);}
   if(!room.visitors.size){rooms.delete(room.id);continue;}
   if(now-room.checkedAt>=policyAge)void current(room);
   if(room.closed||room.checking)continue;if(room.sequence>=2147483647){discard(room,'SERVER_BUSY');continue;}room.sequence++;
   for(const v of room.visitors.values())if(v.socket&&v.state.connected){send(v.socket,snapshot(room,v,'snapshot'));stats.snapshots++;}
  }
  if(now-lastPing>=5000){lastPing=now;for(const c of contexts){if(now-c.pongAt>15000)c.socket.terminate();else if(c.socket.readyState===WebSocket.OPEN)c.socket.ping();}}
  counts();
 },100);timer.unref();
 app.addHook('onClose',async()=>{stopping=true;clearInterval(timer);app.server.off('upgrade',upgrade);for(const c of contexts){clearTimeout(c.joinTimer);c.socket.terminate();}contexts.clear();rooms.clear();await new Promise<void>(resolve=>wss.close(()=>resolve()));counts();});
 return {metrics:()=>{counts();return {...stats};}};
}
