// SPDX-License-Identifier: AGPL-3.0-or-later
import {PresenceMotion,type PresenceVisitor} from './realtime-motion';
import {validatePresenceServerMessage,type PresenceServerMessage} from '@exhibitos/studio-contract';
/** Input is bounded JSON text, never remote executable objects or binary frames. */
export function parsePresenceMessage(raw:unknown,publicationId:string,revision:string,roomIds:ReadonlySet<string>):PresenceServerMessage|null {
 if(typeof raw!=='string'||raw.length>65536||new TextEncoder().encode(raw).length>65536)return null;
 let value:unknown;try{value=JSON.parse(raw);}catch{return null;}
 return validatePresenceServerMessage(value,publicationId,revision,roomIds)?value:null;
}
export interface RealtimeState {status:'solo'|'connecting'|'joined'|'reconnecting'|'failed';selfId:string|null;visitors:(PresenceVisitor&{connected:boolean})[];attempts:number;sequence:number;message:string}
export interface PresenceSocket {readyState:number;bufferedAmount:number;send:(data:string)=>void;close:(code?:number)=>void;onopen:((event:unknown)=>void)|null;onmessage:((event:{data:unknown})=>void)|null;onclose:((event:{code:number})=>void)|null;onerror:((event:unknown)=>void)|null}
interface Options {publicationId:string;revisionSha256:string;roomIds:ReadonlySet<string>;origin:string;changed:(state:RealtimeState)=>void;check:(signal?:AbortSignal)=>Promise<void>;socket?:(url:string)=>PresenceSocket;now?:()=>number;schedule?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;cancel?:(timer:ReturnType<typeof setTimeout>)=>void}
/** Explicit opt-in only; rotating resume secret is private memory, never state/history/storage. */
export class ExhibitionPresence {
 private controller:AbortController|null=null;private socket:PresenceSocket|null=null;private token:string|undefined;private generation=0;private opted=false;private timer:ReturnType<typeof setTimeout>|undefined;private joinTimer:ReturnType<typeof setTimeout>|undefined;private reconnects=0;private sequence=0;private lastPose=-Infinity;private lastServerTime=0;private motion=new PresenceMotion();
 private state:RealtimeState={status:'solo',selfId:null,visitors:[],attempts:0,sequence:0,message:'혼자 관람합니다. 함께 관람은 직접 시작합니다.'};
 constructor(private options:Options){}
 snapshot(){return structuredClone(this.state);}
 private emit(){this.options.changed(this.snapshot());}
 private now(){return this.options.now?.()??performance.now();}
 private schedule(fn:()=>void,ms:number){return (this.options.schedule??setTimeout)(fn,ms);}
 private cancel(timer:ReturnType<typeof setTimeout>|undefined){if(timer!==undefined)(this.options.cancel??clearTimeout)(timer);}
 private detach(){this.controller?.abort();this.controller=null;this.cancel(this.joinTimer);this.joinTimer=undefined;if(this.socket){this.socket.onopen=null;this.socket.onmessage=null;this.socket.onclose=null;this.socket.onerror=null;try{this.socket.close(1000);}catch{/* Already closed. */}this.socket=null;}this.motion.clear();}
 join(){this.leave();this.opted=true;void this.connect();}
 retry(){this.join();}
 private fail(message:string){++this.generation;this.opted=false;this.detach();this.cancel(this.timer);this.timer=undefined;this.token=undefined;this.state.status='failed';this.state.visitors=[];this.state.message=message;this.emit();}
 private async connect(){const generation=++this.generation;if(!this.opted)return;this.state.status=this.state.attempts?'reconnecting':'connecting';this.state.message='함께 관람 연결을 확인합니다. 혼자 관람은 계속 사용할 수 있습니다.';this.emit();
  try{this.controller?.abort();this.controller=new AbortController();await this.options.check(this.controller.signal);if(!this.opted||generation!==this.generation)return;
   const base=new URL(this.options.origin);if(base.protocol!=='http:'&&base.protocol!=='https:')throw Error('ORIGIN_UNSUPPORTED');base.protocol=base.protocol==='https:'?'wss:':'ws:';base.pathname=`/api/v1/publications/${this.options.publicationId}/presence`;base.search='';base.hash='';
   const socket=(this.options.socket??(url=>new WebSocket(url) as unknown as PresenceSocket))(base.toString());this.socket=socket;
   const current=()=>this.opted&&generation===this.generation&&this.socket===socket;
   socket.onopen=()=>{if(current())socket.send(JSON.stringify({version:1,type:'join',publicationId:this.options.publicationId,revisionSha256:this.options.revisionSha256,...(this.token?{resumeToken:this.token}:{})}));};
   socket.onmessage=event=>{if(!current())return;const message=parsePresenceMessage(event.data,this.options.publicationId,this.options.revisionSha256,this.options.roomIds);if(!message){this.fail('실시간 메시지를 검증할 수 없어 혼자 관람으로 돌아갑니다.');return;}
    if(message.type==='pong')return;if(message.type==='error'){if(message.code==='POSE_REJECTED'){this.state.message='서버가 허용하지 않은 위치 변경을 거부했습니다. 현재 관람 위치는 유지됩니다.';this.emit();}else this.fail('함께 관람 연결이 거부되었습니다: '+message.code);return;}
    if(message.type==='snapshot'&&(this.state.status!=='joined'||message.selfId!==this.state.selfId)){this.fail('방문객 identity가 일치하지 않아 연결을 정지했습니다.');return;}
    if(message.type==='welcome'&&this.token&&this.state.selfId!==message.selfId){this.fail('재연결 identity가 일치하지 않아 연결을 정지했습니다.');return;}
    if(message.serverTime<this.lastServerTime){this.fail('실시간 시각이 역행해 연결을 정지했습니다.');return;}
    if(message.type==='snapshot'&&message.sequence<=this.state.sequence)return;
    if(message.type==='welcome'){this.token=message.resumeToken;this.cancel(this.joinTimer);this.joinTimer=undefined;this.sequence=0;this.lastPose=-Infinity;}
    this.lastServerTime=message.serverTime;this.state={status:'joined',selfId:message.selfId,visitors:structuredClone(message.visitors),attempts:this.reconnects,sequence:message.sequence,message:'함께 관람 중입니다. 다른 관람객은 표시만 하며 내 이동은 바꾸지 않습니다.'};this.motion.update(message.visitors.filter(v=>v.visitorId!==message.selfId&&v.connected),this.now());this.emit();
   };
   socket.onclose=event=>{if(!current())return;this.socket=null;this.cancel(this.joinTimer);this.joinTimer=undefined;this.motion.clear();this.state.visitors=[];if(event.code===1008||this.reconnects>=3){this.fail('실시간 연결이 종료되었습니다. 혼자 관람하거나 다시 연결을 선택하세요.');return;}this.reconnects++;this.state.attempts=this.reconnects;this.state.status='reconnecting';this.state.message='연결이 끊어졌습니다. 제한된 횟수로 다시 연결하며 혼자 관람은 유지합니다.';this.emit();this.timer=this.schedule(()=>{this.timer=undefined;void this.connect();},1000*2**(this.state.attempts-1));};
   socket.onerror=()=>{};
   this.joinTimer=this.schedule(()=>{if(current())this.fail('실시간 연결 확인 시간이 초과되었습니다. 혼자 관람은 유지합니다.');},10000);
  }catch{if(generation===this.generation)this.fail('현재 전시 또는 실시간 서비스에 접근할 수 없습니다. 혼자 관람은 계속 사용할 수 있습니다.');}
 }
 pose(roomId:string,position:[number,number,number],yaw:number){if(this.state.status!=='joined'||!this.socket||this.socket.readyState!==1||!this.options.roomIds.has(roomId)||position.length!==3||!position.every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)||!Number.isFinite(yaw))return;const now=this.now();if(!Number.isFinite(now)||now-this.lastPose<100)return;if(this.socket.bufferedAmount>65536){this.fail('실시간 전송 예산을 넘어서 혼자 관람으로 돌아갑니다.');return;}this.lastPose=now;this.sequence++;if(this.sequence>2147483647){this.fail('실시간 순서 예산을 초과했습니다.');return;}try{this.socket.send(JSON.stringify({version:1,type:'pose',seq:this.sequence,roomId,position:[...position],yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw))}));}catch{this.fail('실시간 전송에 실패했습니다. 혼자 관람은 유지합니다.');}}
 avatars(reducedMotion=false){return this.motion.sample(this.now(),reducedMotion);}
 leave(){++this.generation;this.opted=false;this.cancel(this.timer);this.timer=undefined;if(this.socket?.readyState===1){try{this.socket.send(JSON.stringify({version:1,type:'leave'}));}catch{/* Connection already gone. */}}this.detach();this.token=undefined;this.reconnects=0;this.sequence=0;this.lastServerTime=0;this.state={status:'solo',selfId:null,visitors:[],attempts:0,sequence:0,message:'혼자 관람으로 돌아왔습니다. 실시간 위치 전송을 정지했습니다.'};this.emit();}
 dispose(){this.leave();}
}

/** No render or pose work in default solo, failed, connecting or reconnecting states. */
export function advancePresenceFrame(client:ExhibitionPresence,scene:{update:(visitors:readonly PresenceVisitor[])=>void}|null,pose:{roomId:string;position:[number,number,number];yaw:number}|null,reducedMotion:boolean) {
 if(client.snapshot().status!=='joined')return;
 if(pose)client.pose(pose.roomId,pose.position,pose.yaw);scene?.update(client.avatars(reducedMotion));
}
