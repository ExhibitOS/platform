// SPDX-License-Identifier: AGPL-3.0-or-later
export interface VoicePeer {id:string;voice:boolean;muted:boolean;connected:boolean}
export interface VoiceStats {peers:number;microphone:boolean;requesting:boolean;connected:number;receivedBytes:number;sentBytes:number;message:string}
interface Peer {pc:RTCPeerConnection;audio:HTMLAudioElement;making:boolean;ignore:boolean;polite:boolean;generation:number;ice:RTCIceCandidateInit[];signals:Promise<void>;pending:number}
interface VoiceOptions {send:(targetId:string,body:{description?:RTCSessionDescriptionInit;candidate?:{candidate:string;sdpMid:string|null;sdpMLineIndex:number|null}})=>void;changed:(state:VoiceStats)=>void;attach:(audio:HTMLAudioElement)=>void;media?:()=>Promise<MediaStream>;peer?:()=>RTCPeerConnection;audio?:()=>HTMLAudioElement}
/** Direct-only consenting WebRTC mesh. No STUN/TURN, recorder, ambient microphone or remote URL. */
export class OpeningVoice {
 private peers=new Map<string,Peer>();private selfId='';private eligible=false;private generation=0;private micRequest=0;private stream:MediaStream|null=null;private stats:VoiceStats={peers:0,microphone:false,requesting:false,connected:0,receivedBytes:0,sentBytes:0,message:'음성은 직접 허용합니다. 녹음하지 않습니다.'};
 constructor(private options:VoiceOptions){}
 snapshot(){return {...this.stats};}
 private emit(){this.stats.peers=this.peers.size;this.stats.microphone=!!this.stream;this.stats.connected=[...this.peers.values()].filter(p=>p.pc.connectionState==='connected').length;this.options.changed(this.snapshot());}
 private remove(id:string){const peer=this.peers.get(id);if(!peer)return;peer.pc.onicecandidate=null;peer.pc.ontrack=null;peer.pc.onnegotiationneeded=null;peer.pc.onconnectionstatechange=null;peer.pc.close();peer.audio.pause();peer.audio.srcObject=null;peer.audio.remove();this.peers.delete(id);}
 update(selfId:string,participants:readonly VoicePeer[],consented:boolean,blocked:ReadonlySet<string>){const self=participants.find(p=>p.id===selfId);this.selfId=selfId;this.eligible=consented&&!!self?.voice&&!self.muted&&self.connected;
  if(!this.eligible){this.stop();return;}const ids=new Set(participants.filter(p=>p.id!==selfId&&p.voice&&!p.muted&&p.connected&&!blocked.has(p.id)).slice(0,5).map(p=>p.id));for(const id of this.peers.keys())if(!ids.has(id))this.remove(id);
  for(const id of ids)if(!this.peers.has(id)){try{this.create(id);}catch{this.stats.message='이 브라우저는 직접 음성 연결을 시작할 수 없습니다. 글 대화는 유지됩니다.';}}this.emit();
 }
 private create(id:string){const pc=this.options.peer?.()??new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all',bundlePolicy:'max-bundle'}),audio=this.options.audio?.()??new Audio();audio.autoplay=false;audio.controls=true;audio.setAttribute('aria-label','음성 방문객 '+id);this.options.attach(audio);
  const peer:Peer={pc,audio,making:false,ignore:false,polite:this.selfId>id,generation:this.generation,ice:[],signals:Promise.resolve(),pending:0};this.peers.set(id,peer);
  pc.onicecandidate=event=>{if(event.candidate&&this.current(id,peer))this.options.send(id,{candidate:{candidate:event.candidate.candidate,sdpMid:event.candidate.sdpMid,sdpMLineIndex:event.candidate.sdpMLineIndex}});};
  pc.ontrack=event=>{if(!this.current(id,peer))return;audio.srcObject=event.streams[0]??new MediaStream([event.track]);void audio.play().catch(()=>{this.stats.message='브라우저가 소리를 막았습니다. 음성 듣기 재시도를 직접 선택하세요.';this.emit();});};
  pc.onconnectionstatechange=()=>{if(this.current(id,peer)){this.stats.message=pc.connectionState==='failed'?'직접 음성 연결에 실패했습니다. 글 대화를 계속 사용할 수 있습니다.':'직접 음성 연결을 확인합니다.';this.emit();}};
  pc.onnegotiationneeded=()=>{if(this.selfId<id||pc.remoteDescription)void this.offer(id,peer);};
  const track=this.stream?.getAudioTracks()[0];pc.addTransceiver(track??'audio',{direction:track?'sendrecv':'recvonly',...(track&&this.stream?{streams:[this.stream]}:{})});
 }
 private current(id:string,peer:Peer){return this.eligible&&peer.generation===this.generation&&this.peers.get(id)===peer;}
 private async offer(id:string,peer:Peer){if(!this.current(id,peer)||peer.making||peer.pc.signalingState!=='stable')return;try{peer.making=true;const offer=await peer.pc.createOffer();if(!this.current(id,peer)||peer.pc.signalingState!=='stable')return;await peer.pc.setLocalDescription(offer);if(this.current(id,peer)&&peer.pc.localDescription)this.options.send(id,{description:{type:peer.pc.localDescription.type as 'offer',sdp:peer.pc.localDescription.sdp}});}catch{if(this.current(id,peer)){this.stats.message='음성 협상을 완료할 수 없습니다. 글 대화는 유지됩니다.';this.emit();}}finally{peer.making=false;}}
 async signal(fromId:string,body:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}){const peer=this.peers.get(fromId);if(!peer||!this.current(fromId,peer))return;if(peer.pending>=64){this.remove(fromId);this.stats.message='음성 신호 한도를 초과해 해당 연결을 정지했습니다.';this.emit();return;}peer.pending++;const input=structuredClone(body);peer.signals=peer.signals.then(()=>this.applySignal(fromId,peer,input)).finally(()=>{peer.pending--;});await peer.signals;}
 private async applySignal(fromId:string,peer:Peer,body:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}){if(!this.current(fromId,peer))return;
  try{if(body.description){const collision=body.description.type==='offer'&&(peer.making||peer.pc.signalingState!=='stable');peer.ignore=!peer.polite&&collision;if(peer.ignore)return;if(collision&&peer.pc.signalingState!=='stable')await peer.pc.setLocalDescription({type:'rollback'});if(!this.current(fromId,peer))return;await peer.pc.setRemoteDescription(body.description);if(!this.current(fromId,peer))return;for(const candidate of peer.ice.splice(0)){if(!this.current(fromId,peer))return;await peer.pc.addIceCandidate(candidate);}if(body.description.type==='offer'){await peer.pc.setLocalDescription(await peer.pc.createAnswer());if(this.current(fromId,peer)&&peer.pc.localDescription)this.options.send(fromId,{description:{type:'answer',sdp:peer.pc.localDescription.sdp}});}}
   else if(body.candidate&&!peer.ignore){if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(body.candidate);else{if(peer.ice.length>=64){this.remove(fromId);this.stats.message='보류된 음성 후보 한도를 초과했습니다.';this.emit();return;}peer.ice.push(structuredClone(body.candidate));}}
  }catch{if(this.current(fromId,peer)){this.stats.message='음성 신호를 적용할 수 없습니다. 직접 연결이 가능한 환경에서 재시도하세요.';this.emit();}}
 }
 /** Only invoke directly from the explicit microphone click, never from reconnect/snapshot. */
 async microphone(enabled:boolean){if(!enabled){this.stopMicrophone();return;}const request=++this.micRequest;if(!this.eligible)throw Error('VOICE_NOT_CONSENTED');const generation=this.generation;this.stats.requesting=true;this.emit();
  let stream:MediaStream;try{stream=await (this.options.media?.()??navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}));}catch(error){if(request===this.micRequest){this.stats.requesting=false;this.emit();}throw error;}
  if(generation!==this.generation||request!==this.micRequest||!this.eligible){for(const track of stream.getTracks())track.stop();return;}
  this.stopMicrophone();this.stream=stream;const track=stream.getAudioTracks()[0];for(const [id,peer]of this.peers){const transceiver=peer.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');if(transceiver){await transceiver.sender.replaceTrack(track??null);if(!this.current(id,peer)||this.stream!==stream)continue;transceiver.direction='sendrecv';void this.offer(id,peer);}}
  if(this.stream!==stream||generation!==this.generation)return;
  this.stats.message='마이크를 켰습니다. 나가기·숨김·호스트 음소거는 실제 트랙을 정지합니다.';this.emit();
 }
 private stopMicrophone(){this.micRequest++;this.stats.requesting=false;if(this.stream){for(const track of this.stream.getTracks())track.stop();this.stream=null;}for(const peer of this.peers.values()){for(const sender of peer.pc.getSenders())if(sender.track)void sender.replaceTrack(null).catch(()=>{});}this.emit();}
 retryListening(){for(const peer of this.peers.values())void peer.audio.play().catch(()=>{});}
 async measure(){let receivedBytes=0,sentBytes=0;const generation=this.generation;for(const peer of this.peers.values()){try{const report=await peer.pc.getStats();report.forEach(stat=>{if(stat.type==='inbound-rtp'&&stat.kind==='audio')receivedBytes+=Number(stat.bytesReceived??0);if(stat.type==='outbound-rtp'&&stat.kind==='audio')sentBytes+=Number(stat.bytesSent??0);});}catch{/* Closed peer. */}}if(generation===this.generation){this.stats.receivedBytes=receivedBytes;this.stats.sentBytes=sentBytes;this.emit();}}
 stop(){this.generation++;this.eligible=false;this.stopMicrophone();for(const id of this.peers.keys())this.remove(id);this.stats.receivedBytes=0;this.stats.sentBytes=0;this.emit();}
}
