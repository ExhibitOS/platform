// SPDX-License-Identifier: AGPL-3.0-or-later
import { experienceFor, presentationFor, curationFor, curationDurationValid } from "@exhibitos/studio-contract";
import type { PublicPublication } from "../publication-client";
import type { NavigationState } from "./navigation";
import { fetchVerifiedAsset } from "./loading";
import { authoredDistanceGain, occlusionGain } from "./audio-geometry";

export type FloorSound = "wood" | "stone" | "concrete" | "carpet";
export interface VoicePlayback {
  assetId: string | null; positionSeconds: number; durationSeconds: number; status: "playing" | "ended" | "stopped" | "unavailable";
}
export interface AudioState {
  voice: VoicePlayback;
  zoneTransitions: boolean;
  zoneId: string | null;
  enabled: boolean;
  muted: boolean;
  volume: number;
  suspended: boolean;
  context: string;
  footsteps: number;
  material: FloorSound;
  roomId: string | null;
  loaded: number;
  decodedBytes: number;
  requests: number;
  active: number;
  reverbSeconds: number;
  zoneGain: number;
  message: string;
}
export interface AudioApi {
  playVoice: (assetId: string) => Promise<void>;
  stopVoice: () => void;
  voicePlayback: () => VoicePlayback;
  subscribeVoice: (changed: (playback: VoicePlayback) => void) => () => void;
}
interface Experience {
  footsteps: Array<{ surfaceId: string; material: string; assetId?: string }>;
  rooms: Array<{ roomId: string; reverb: number }>;
  voices: Array<{ assetId: string; placementId: string; transcript:string }>;
}
const MAX_DECODED = 24 * 1024 * 1024;
/** Each original, deterministic waveform is synthesized locally; no recordings or network assets. */
export function footstepWave(material: FloorSound, rate: number): Float32Array {
  const duration = material === "carpet" ? 0.09 : material === "stone" ? 0.19 : 0.14;
  const samples = new Float32Array(Math.ceil(rate * duration));
  let seed = 1729, low = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1, t = i / rate;
    low = low * 0.82 + noise * 0.18;
    const attack = Math.min(1, t / 0.004);
    const decay = Math.exp(-t * (material === "carpet" ? 65 : 35));
    const tone = Math.sin(t * Math.PI * 2 * (material === "wood" ? 165 : material === "stone" ? 950 : 80));
    samples[i] = attack * decay * (material === "carpet" ? low * 0.2 : material === "wood" ? low * 0.45 + tone * 0.35 : material === "stone" ? noise * 0.4 + tone * 0.2 : noise * 0.38 + low * 0.3);
  }
  return samples;
}
export function distanceGain(distance: number, radius: number): number {
  return !Number.isFinite(distance) || radius <= 0 ? 0 : Math.max(0, Math.min(1, 1 - distance / radius)) ** 2;
}
/** Distance, rather than requested velocity, clocks footsteps; collisions and look-only input cannot step. */
export class StrideClock {
  private previous?: [number, number, number];
  private distance = 0;
  reset() { this.previous = undefined; this.distance = 0; }
  advance(state: NavigationState, active: boolean): boolean {
    const p = state.eyePosition, previous = this.previous;
    this.previous = [...p];
    if (!active || !state.grounded || state.paused || state.recovered) { this.distance = 0; return false; }
    if (!previous) return false;
    const delta = Math.hypot(p[0] - previous[0], p[2] - previous[2]);
    if (delta > 0.45) { this.distance = 0; return false; }
    this.distance += delta;
    const speed = Math.hypot(state.velocity[0], state.velocity[2]);
    const stride = Math.max(0.3, Math.min(0.65, 0.32 + speed * 0.14));
    if (this.distance < stride) return false;
    this.distance %= stride;
    return true;
  }
}
/** Bound the PCM payload before browser decoding; header claims alone do not qualify media. */
export function verifyPcmWav(bytes: ArrayBuffer) {
  const view=new DataView(bytes), tag=(at:number)=>String.fromCharCode(...new Uint8Array(bytes,at,4));
  if(bytes.byteLength<44||bytes.byteLength>12*1024*1024||tag(0)!=="RIFF"||tag(8)!=="WAVE"||view.getUint32(4,true)!==bytes.byteLength-8)throw Error("AUDIO_WAV_INVALID");
  let format: {channels:number;rate:number;align:number}|undefined, data=0;
  for(let at=12;at<bytes.byteLength;) {
    if(at+8>bytes.byteLength)throw Error("AUDIO_WAV_INVALID");
    const size=view.getUint32(at+4,true), end=at+8+size;
    if(end>bytes.byteLength)throw Error("AUDIO_WAV_INVALID");
    if(tag(at)==="fmt ") {
      if(format||size!==16||view.getUint16(at+8,true)!==1||view.getUint16(at+22,true)!==16)throw Error("AUDIO_WAV_INVALID");
      const channels=view.getUint16(at+10,true), rate=view.getUint32(at+12,true), align=view.getUint16(at+20,true);
      if(channels<1||channels>2||rate<8000||rate>48000||align!==channels*2||view.getUint32(at+16,true)!==rate*align)throw Error("AUDIO_WAV_INVALID");
      format={channels,rate,align};
    } else if(tag(at)==="data") { if(!format||data||size===0)throw Error("AUDIO_WAV_INVALID");data=size; }
    else throw Error("AUDIO_WAV_INVALID");
    at=end+(size%2);
    if(at>bytes.byteLength)throw Error("AUDIO_WAV_INVALID");
  }
  if(!format||!data||data%format.align||data/(format.rate*format.align)>60)throw Error("AUDIO_WAV_INVALID");
  return {channels:format.channels,sampleRate:format.rate,duration:data/(format.rate*format.align)};
}
export class ExhibitionAudio implements AudioApi {
  private context?: AudioContext;
  private master?: GainNode;
  private convolver?: ConvolverNode;
  private wet?: GainNode;
  private abort = new AbortController();
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer>>();
  private explicitLoads = new Set<string>();
  private steps = new Map<FloorSound, AudioBuffer>();
  private playing = new Set<AudioBufferSourceNode>();
  private scriptGeneration=0;
  private scriptMediaGenerations=new Map<string,number>();
  private scriptSources=new Map<string,AudioBufferSourceNode>();
  private voice?: AudioBufferSourceNode;
  private voiceStartedAt = 0;
  private voiceTimer?: ReturnType<typeof setInterval>;
  private voiceListeners = new Set<(playback: VoicePlayback) => void>();
  private transitionZone?: string;
  private zoneRequest?: string;
  private zone?: { id: string; source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode };
  private stride = new StrideClock();
  private disposed = false;
  private generation = 0;
  private visible = true;
  private moving = false;
  private audible = false;
  private emittedZoneGain = 0;
  private loadQueue: Promise<unknown> = Promise.resolve();
  private availabilityTimer?: ReturnType<typeof setInterval>;
  private detail = false;
  private allowed = new Set<string>();
  private position: [number, number, number] = [0, 0, 0];
  private room?: string;
  private experience: Experience;
  private curation: ReturnType<typeof curationFor>;
  private state: AudioState = { voice: {assetId:null,positionSeconds:0,durationSeconds:0,status:"stopped"}, zoneTransitions:false, zoneId:null, enabled: false, muted: false, volume: 0.5, suspended: true, context: "not-created", footsteps: 0, material: "concrete", roomId: null, loaded: 0, decodedBytes: 0, requests: 0, active: 0, reverbSeconds: 0, zoneGain: 0, message: "소리는 선택해서 켭니다. 음성 설명은 소리 없이 읽을 수 있습니다." };
  constructor(private publication: PublicPublication, private changed: (state: AudioState) => void) {
    this.experience = experienceFor(publication.exhibition);
    this.curation = curationFor(publication.exhibition);
    const start=presentationFor(publication.exhibition).startCamera;
    this.position=start?this.worldPosition(start.roomId,start.position):[0,0,0];
    this.setRoom(start?.roomId ?? publication.exhibition.rooms[0]?.id);
  }
  voicePlayback(): VoicePlayback {
    const voice=this.state.voice;
    return {...voice,positionSeconds:voice.status==="playing"&&this.context?Math.min(voice.durationSeconds,Math.max(0,this.context.currentTime-this.voiceStartedAt)):voice.positionSeconds};
  }
  subscribeVoice(changed:(playback:VoicePlayback)=>void) {this.voiceListeners.add(changed);changed(this.voicePlayback());return ()=>{this.voiceListeners.delete(changed);};}
  private voiceStatus(status:VoicePlayback["status"]) {this.state.voice={...this.voicePlayback(),...(status==="ended"?{positionSeconds:this.state.voice.durationSeconds}:{}),status};if(this.voiceTimer)clearInterval(this.voiceTimer);this.voiceTimer=undefined;for(const listener of this.voiceListeners)listener(this.voicePlayback());}
  snapshot() { return { ...this.state,voice:this.voicePlayback() }; }
  private emit() {
    if (this.disposed) return;
    this.state.context = this.context?.state ?? "not-created";
    this.state.loaded = this.buffers.size;
    this.state.decodedBytes = [...this.buffers.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0);
    this.state.active = this.playing.size;
    this.state.suspended = !this.visible || !this.audible;
    this.emittedZoneGain=this.state.zoneGain;
    this.changed(this.snapshot());
  }
  /** Must be called synchronously from the opt-in click, never from mount/effect. */
  async enable() {
    if (this.disposed) return;
    try {
      this.context ??= new AudioContext({sampleRate:48000});
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.convolver = this.context.createConvolver();
        this.wet = this.context.createGain();
        this.convolver.connect(this.wet).connect(this.master);
      }
      await this.context.resume();
      if (this.disposed) return;
      this.state.enabled = this.context.state === "running";
      this.state.message = this.state.enabled ? "소리를 켰습니다. 걷기에서 발소리, 음성 버튼에서 설명을 들을 수 있습니다." : "브라우저가 소리를 허용하지 않았습니다. 설명을 읽거나 다시 켜세요.";
      this.updateMaster();
      if (this.state.enabled) { const room=this.room; this.room=undefined; this.setRoom(room); this.preload();
        this.availabilityTimer ??= setInterval(()=>{if(this.playing.size || this.moving)void this.checkAvailability().catch(()=>{this.state.enabled=false;this.silence();this.buffers.clear();this.state.message="전시 또는 소리 권한이 변경되었습니다. 재생을 멈췄습니다.";this.emit();});},10000);
      }
    } catch { this.state.message = "소리를 시작할 수 없습니다. 음성 설명은 글로 읽을 수 있습니다."; }
    this.emit();
  }
  volume(value: number) { this.state.volume = Number.isFinite(value)?Math.max(0, Math.min(1, value)):0; this.updateMaster(); this.emit(); }
  mute(value: boolean) { this.state.muted = value; if (value) this.silence(); this.updateMaster(); this.emit(); }
  private updateMaster() { if (this.master && this.context) this.master.gain.setValueAtTime(this.state.muted || !this.visible || !this.audible ? 0 : this.state.volume, this.context.currentTime); }
  private stop(source: AudioBufferSourceNode) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); this.playing.delete(source); source.onended?.(new Event("ended")); source.onended=null; }
  private silence() { this.stopScriptAudio(); this.audible=false; this.updateMaster(); this.generation++; this.voice = undefined; this.voiceStatus("stopped"); for (const source of [...this.playing]) this.stop(source); this.zone = undefined; this.state.zoneId=null; this.zoneRequest=undefined; this.transitionZone=undefined; this.state.zoneGain=0; this.stride.reset(); }
  lifecycle(moving: boolean, detail = false) {
    this.moving = moving; this.detail = detail;
    if (!moving) this.silence();
    else { this.audible=true; this.updateMaster(); }
    this.emit();
  }
  visibility(visible: boolean) { this.visible = visible; if (!visible) this.silence(); this.updateMaster(); this.emit(); }
  updatePose(position: [number,number,number], yaw: number) {
    if(this.moving)return;
    const room=this.publication.exhibition.rooms.find(room=>{
      const p=position.map((v,i)=>v-room.transform.position[i]!), [x,y,z,w]=room.transform.rotation;
      const tx=2*(-y*p[2]!+z*p[1]!),ty=2*(-z*p[0]!+x*p[2]!),tz=2*(-x*p[1]!+y*p[0]!);
      const a=p[0]!+w*tx-y*tz+z*ty,b=p[1]!+w*ty-z*tx+x*tz,c=p[2]!+w*tz-x*ty+y*tx;
      return Math.abs(a)<=room.dimensions.width/2&&Math.abs(c)<=room.dimensions.depth/2&&b>=0&&b<=room.dimensions.height;
    });
    this.update({eyePosition:position,yaw,velocity:[0,0,0],grounded:false,steps:0,paused:true,blocked:false,recovered:false,roomId:room?.id});
  }
  update(state: NavigationState) {
    this.position = [...state.eyePosition];
    this.setRoom(state.roomId);
    if (this.context && this.state.enabled) {
      const listener = this.context.listener, now = this.context.currentTime;
      listener.positionX.setValueAtTime(this.position[0], now); listener.positionY.setValueAtTime(this.position[1], now); listener.positionZ.setValueAtTime(this.position[2], now);
      listener.forwardX.setValueAtTime(-Math.sin(state.yaw), now); listener.forwardY.setValueAtTime(0, now); listener.forwardZ.setValueAtTime(-Math.cos(state.yaw), now);
      const material = this.experience.footsteps.find(f => f.surfaceId === state.floorSurfaceId)?.material;
      this.state.material = material === "wood" || material === "carpet" || material === "stone" ? material : material === "metal" ? "stone" : "concrete";
      if (this.stride.advance(state, this.moving && this.visible && !this.state.muted && !this.detail) && this.context.state === "running") this.footstep(state);
      if (this.zone) {
        const zone = this.publication.exhibition.audioZones.find(z => z.id === this.zone!.id)!;
        const p = this.worldPosition(zone.roomId, zone.position);
        const gain=this.zoneGain(zone,p);
        this.zone.gain.gain.setValueAtTime(gain, now);
        const previousGain=this.state.zoneGain;
        this.state.zoneGain=gain;
        if(Math.abs(gain-this.emittedZoneGain)>0.005 || (gain===0 && previousGain!==0) || (gain!==0 && previousGain===0)) this.emit();
      }
    }
    this.transition();
  }
  private footstep(state: NavigationState) {
    this.audible=true;this.updateMaster();
    const context = this.context!;
    const custom = this.experience.footsteps.find(f => f.surfaceId === state.floorSurfaceId)?.assetId;
    let buffer = custom ? this.buffers.get(custom) : undefined;
    if (!buffer) {
      buffer = this.steps.get(this.state.material);
      if (!buffer) { const wave = footstepWave(this.state.material, context.sampleRate); buffer = context.createBuffer(1, wave.length, context.sampleRate); buffer.copyToChannel(new Float32Array(wave), 0); this.steps.set(this.state.material, buffer); }
    }
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = 0.35; source.connect(gain).connect(this.master!); gain.connect(this.convolver!);
    this.track(source, () => gain.disconnect()); source.start(0, 0, Math.min(buffer.duration, 0.2)); this.state.footsteps++; this.emit();
  }
  private track(source: AudioBufferSourceNode, cleanup: () => void = () => {}) { this.playing.add(source); source.onended = () => { this.playing.delete(source); source.disconnect(); cleanup(); this.emit(); }; }
  private worldPosition(roomId: string, local: [number, number, number]): [number, number, number] {
    const room = this.publication.exhibition.rooms.find(r => r.id === roomId); if (!room) return local;
    const [x, y, z, w] = room.transform.rotation, [a, b, c] = local;
    const tx = 2 * (y*c-z*b), ty = 2*(z*a-x*c), tz = 2*(x*b-y*a);
    return [a+w*tx+y*tz-z*ty+room.transform.position[0], b+w*ty+z*tx-x*tz+room.transform.position[1], c+w*tz+x*ty-y*tx+room.transform.position[2]];
  }
  private setRoom(id?: string) {
    if (!id || id === this.room) return;
    this.room = id; this.state.roomId = id;
    const doc = this.publication.exhibition, index = doc.rooms.findIndex(r => r.id === id);
    const rooms = new Set([id, doc.rooms[index + 1]?.id].filter(Boolean));
    this.allowed = new Set(doc.audioZones.filter(z => rooms.has(z.roomId)).map(z => z.assetId));
    for(const voice of this.experience.voices) {const placement=doc.placements.find(p=>p.id===voice.placementId);if(placement&&rooms.has(placement.roomId))this.allowed.add(voice.assetId);}
    for (const entry of this.experience.footsteps) { const surface = doc.surfaces.find(s => s.id === entry.surfaceId); if (entry.assetId && surface && rooms.has(surface.roomId)) this.allowed.add(entry.assetId); }
    for (const [key] of this.buffers) if (!this.allowed.has(key) && this.voice?.buffer !== this.buffers.get(key)) this.buffers.delete(key);
    if (this.context && this.convolver && this.wet) {
      const room = doc.rooms[index]!;
      const seconds = Math.min(1.8, Math.max(0.15, Math.cbrt(room.dimensions.width*room.dimensions.height*room.dimensions.depth)/12));
      const impulse = this.context.createBuffer(2, Math.ceil(seconds*this.context.sampleRate), this.context.sampleRate);
      for (let channel = 0; channel < 2; channel++) { const samples = impulse.getChannelData(channel); let seed = 97 + channel; for (let i=0;i<samples.length;i++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; samples[i]=(seed/2147483648-1)*Math.exp(-6*i/samples.length); } }
      this.convolver.buffer = impulse; this.wet.gain.value = Math.max(0,Math.min(1,this.experience.rooms.find(r=>r.roomId===id)?.reverb ?? 0.12)); this.state.reverbSeconds = seconds;
    }
    if (this.state.enabled) this.preload(); this.emit();
  }
  private preload() { if (!this.state.enabled || !this.visible || this.disposed || this.state.muted) return; for (const id of [...this.allowed].slice(0, 8)) void this.load(id,true).then(()=>{if(!this.allowed.has(id)&&this.buffers.get(id)!==this.voice?.buffer)this.buffers.delete(id);this.emit();}).catch((error) => { if(error instanceof Error && error.message === "AUDIO_PRELOAD_STALE")return; this.state.message="일부 소리가 없거나 검증되지 않았습니다. 글 설명과 기본 발소리는 유지됩니다."; this.emit(); }); }
  private load(id: string, preload = false): Promise<AudioBuffer> {
    if(!preload)this.explicitLoads.add(id);
    const cached = this.buffers.get(id); if (cached) {this.explicitLoads.delete(id);return Promise.resolve(cached);}
    const pending = this.pending.get(id); if (pending) return pending;
    const promise = this.loadQueue.catch(()=>{}).then(async () => {
      if (!this.state.enabled || !this.context || this.disposed) throw Error("AUDIO_NOT_ENABLED");
      if(preload && ((!this.visible||this.state.muted)||(!this.allowed.has(id) && !this.explicitLoads.has(id))))throw Error("AUDIO_PRELOAD_STALE");
      const inventory = this.publication.exhibition.mediaAssets.find(a => a.id === id), asset = this.publication.assets.find(a => a.assetId === id);
      if (!inventory || !asset || inventory.mime !== "audio/wav") throw Error("AUDIO_MISSING");
      this.state.requests++; this.emit();
      const bytes = await fetchVerifiedAsset({ publicationId:this.publication.publication.id, revisionSha256:this.publication.publication.revisionSha256, asset, inventory, signal:this.abort.signal, maxBytes:12*1024*1024, ...this.publication.local });
      const pcm=verifyPcmWav(bytes);
      if(!curationDurationValid(this.publication.exhibition,id,pcm.duration))throw Error("AUDIO_TRANSCRIPT_DURATION_MISMATCH");
      const buffer = await this.context.decodeAudioData(bytes);
      if (this.disposed || buffer.duration>60 || buffer.numberOfChannels>2 || buffer.sampleRate>48000 || buffer.sampleRate<8000) throw Error("AUDIO_DECODE_LIMIT");
      const size = buffer.length * buffer.numberOfChannels * 4;
      while (size + [...this.buffers.values()].reduce((n,b)=>n+b.length*b.numberOfChannels*4,0)>MAX_DECODED) { const key = [...this.buffers.keys()].find(k=>this.buffers.get(k)!==this.voice?.buffer && this.buffers.get(k)!==this.zone?.source.buffer && ![...this.scriptSources.values()].some(s=>s.buffer===this.buffers.get(k))); if (!key) throw Error("AUDIO_CACHE_LIMIT"); this.buffers.delete(key); }
      this.buffers.set(id, buffer); this.emit(); return buffer;
    }).finally(()=>{this.pending.delete(id);this.explicitLoads.delete(id);});
    this.loadQueue = promise;
    this.pending.set(id,promise); return promise;
  }
  private async checkAvailability(signal?:AbortSignal) {
    if(signal?.aborted)throw Error("AUDIO_CANCELLED");
    if(this.publication.local) return this.publication.local.check();
    const response=await fetch(`/api/v1/publications/${this.publication.publication.id}`,{credentials:"omit",cache:"no-store",signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000),...(signal?[signal]:[])])});
    if(!response.ok)throw Error("PUBLICATION_UNAVAILABLE");
    const value=await response.json() as {publication?:{id?:string;status?:string;revisionSha256?:string}} | null;
    if(value?.publication?.id!==this.publication.publication.id||value.publication.status!=="published"||value.publication.revisionSha256!==this.publication.publication.revisionSha256)throw Error("PUBLICATION_UNAVAILABLE");
  }
  async playVoice(id: string) {
    this.stopVoice();
    const generation = this.generation;
    try {
      if(!this.experience.voices.some(v=>v.assetId===id)) throw Error("AUDIO_MISSING");
      if (!this.state.enabled) await this.enable();
      if(!this.state.enabled || this.context?.state !== "running") throw Error("AUDIO_BLOCKED");
      const cancelled = () => this.disposed || !this.visible || this.state.muted || generation!==this.generation;
      if(cancelled()) throw Error("AUDIO_CANCELLED");
      await this.checkAvailability();
      const buffer = await this.load(id);
      if(cancelled()) throw Error("AUDIO_CANCELLED");
      const source=this.context.createBufferSource();
      source.buffer=buffer;
      source.connect(this.master!);
      this.voice=source;
      this.track(source,()=>{ if(this.voice===source){this.voice=undefined;this.state.voice.positionSeconds=this.state.voice.durationSeconds;this.voiceStatus("ended");} });
      try { source.start(); } catch(error) {this.stop(source);this.voice=undefined;throw error;}
      this.voiceStartedAt=this.context.currentTime;
      this.state.voice={assetId:id,positionSeconds:0,durationSeconds:Number.isFinite(buffer.duration)?buffer.duration:0,status:"playing"};
      this.voiceTimer=setInterval(()=>{this.emit();for(const listener of this.voiceListeners)listener(this.voicePlayback());},100);
      for(const listener of this.voiceListeners)listener(this.voicePlayback());
      this.audible=true;
      this.updateMaster();
      this.state.message="음성 설명 재생 중입니다.";
      this.emit();
    } catch(error) {
      if(generation===this.generation) {
        this.state.voice={assetId:id,positionSeconds:0,durationSeconds:0,status:"unavailable"};this.voiceStatus("unavailable");
        this.state.message=error instanceof Error && error.message === "AUDIO_CANCELLED"
          ? "음성 재생을 취소했습니다. 대본은 계속 읽을 수 있습니다."
          : "음성을 재생할 수 없습니다. transcript를 읽으세요.";
      }
      this.emit();
      // Promise success means an actual source started. Callers announce fallback on rejection.
      throw error;
    }
  }
  stopVoice() { this.generation++; const voice=this.voice; this.voice=undefined; this.voiceStatus("stopped"); if(voice)this.stop(voice); this.emit(); }
  stopZone() {this.generation++;if(this.zone)this.stop(this.zone.source);this.zone=undefined;this.zoneRequest=undefined;this.state.zoneId=null;this.state.zoneGain=0;this.emit();}
  async playZone(id: string) {
    const zone=this.publication.exhibition.audioZones.find(z=>z.id===id);
    if(!zone)return;
    this.silence();
    this.zoneRequest=id;
    const generation=this.generation;
    const cancelled=()=>this.disposed||!this.visible||this.state.muted||generation!==this.generation;
    try {
      if(!this.state.enabled)await this.enable();
      if(cancelled())return;
      if(!this.state.enabled||this.context?.state!=="running")throw Error("AUDIO_BLOCKED");
      await this.checkAvailability();
      if(cancelled())return;
      const buffer=await this.load(zone.assetId);
      if(cancelled())return;
      const context=this.context, source=context.createBufferSource(), gain=context.createGain(), panner=context.createPanner();
      source.buffer=buffer;
      source.loop=true;
      panner.panningModel="HRTF";
      panner.distanceModel="linear";
      panner.rolloffFactor=0;
      const p=this.worldPosition(zone.roomId,zone.position);
      panner.positionX.value=p[0];panner.positionY.value=p[1];panner.positionZ.value=p[2];
      gain.gain.value=this.zoneGain(zone,p);
      source.connect(panner).connect(gain).connect(this.master!);
      gain.connect(this.convolver!);
      this.zone={id,source,gain,panner};
      this.state.zoneId=id;
      this.state.zoneGain=gain.gain.value;
      this.track(source,()=>{panner.disconnect();gain.disconnect();if(this.zone?.source===source)this.zone=undefined;});
      try {source.start();}catch(error){this.stop(source);this.zone=undefined;this.state.zoneId=null;this.state.zoneGain=0;throw error;}
      this.audible=true;this.updateMaster();
      this.state.message="선택한 공간 소리를 재생합니다. 일시 정지하면 멈춥니다.";
    } catch {
      if(generation===this.generation)this.state.message="공간 소리를 재생할 수 없습니다. transcript를 읽으세요.";
    }
    if(this.zoneRequest===id)this.zoneRequest=undefined;
    this.emit();
  }
  private zoneGain(zone:PublicPublication["exhibition"]["audioZones"][number],p:[number,number,number]) {
    const distance=Math.hypot(...p.map((v,i)=>v-this.position[i]!));
    const profile=this.curation.audioZones.find(z=>z.zoneId===zone.id);
    if(!profile)return zone.roomId===this.room?zone.volume*distanceGain(distance,zone.radius):0;
    const gain=zone.volume*authoredDistanceGain(distance,profile.referenceDistance,profile.maxDistance,profile.rolloff)*(profile.occlusion.enabled?occlusionGain(this.publication.exhibition,this.position,p,profile.occlusion.closedGain):1);
    return Number.isFinite(gain)?Math.max(0,Math.min(1,gain)):0;
  }
  /** The explicit opt-in itself is a user gesture; base zone autoplay remains false. */
  async zoneTransitions(enabled:boolean) {
    this.state.zoneTransitions=enabled;this.transitionZone=undefined;
    if(!enabled)this.stopZone();else{if(!this.state.enabled)await this.enable();this.transition();}
    this.emit();
  }
  private transition() {
    if(!this.state.zoneTransitions||!this.state.enabled||!this.visible||this.state.muted||!this.moving||this.detail)return;
    const zone=this.publication.exhibition.audioZones.find(z=>z.roomId===this.room&&Math.hypot(...this.worldPosition(z.roomId,z.position).map((v,i)=>v-this.position[i]!))<z.radius);
    if(zone?.id===this.transitionZone)return;
    this.transitionZone=zone?.id;
    if(zone){if(this.zone?.id!==zone.id&&this.zoneRequest!==zone.id)void this.playZone(zone.id);}else this.stopZone();
  }
  async checkScriptAvailability(signal?:AbortSignal) {await this.checkAvailability(signal);if(signal?.aborted)throw Error("AUDIO_CANCELLED");}
  stopScriptAudio(id?:string) {if(id===undefined){this.scriptGeneration++;this.scriptMediaGenerations.clear();}else{if(!this.publication.exhibition.mediaAssets?.some(a=>a.id===id))return;this.scriptMediaGenerations.set(id,(this.scriptMediaGenerations.get(id)??0)+1);}for(const [key,source]of this.scriptSources){if(id===undefined||key===id){this.stop(source);this.scriptSources.delete(key);}}}
  async playScriptAudio(id:string,volume:number,consent:()=>boolean) {
    const generation=this.scriptGeneration,mediaGeneration=this.scriptMediaGenerations.get(id)??0;
    const current=()=>generation===this.scriptGeneration&&mediaGeneration===(this.scriptMediaGenerations.get(id)??0)&&!this.disposed&&this.visible&&!this.state.muted&&this.state.enabled&&this.context?.state==='running'&&consent();
    if(!current())throw Error('SCRIPT_AUDIO_DENIED');
    if(!this.publication.exhibition.audioZones?.some(z=>z.assetId===id&&z.transcript.trim().length>0)&&!this.experience.voices.some(v=>v.assetId===id&&v.transcript.trim().length>0))throw Error('SCRIPT_AUDIO_TRANSCRIPT_MISSING');
    if(!Number.isFinite(volume)||volume<0||volume>1||!this.publication.exhibition.mediaAssets.some(a=>a.id===id&&a.mime==='audio/wav')||!this.publication.assets.some(a=>a.assetId===id))throw Error('AUDIO_MISSING');
    await this.checkAvailability();if(!current())throw Error('AUDIO_CANCELLED');
    const buffer=await this.load(id);if(!current())throw Error('AUDIO_CANCELLED');
    if(!this.scriptSources.has(id)&&this.scriptSources.size>=4)throw Error('SCRIPT_AUDIO_LIMIT');
    const source=this.context!.createBufferSource(),gain=this.context!.createGain();source.buffer=buffer;gain.gain.value=volume;
    const previous=this.scriptSources.get(id);if(previous)this.stop(previous);
    source.connect(gain).connect(this.master!);this.scriptSources.set(id,source);
    this.track(source,()=>{gain.disconnect();if(this.scriptSources.get(id)===source)this.scriptSources.delete(id);});
    try{source.start();}catch(error){this.stop(source);throw error;}
    this.audible=true;this.updateMaster();this.emit();
  }
  dispose() { if(this.disposed)return; this.silence(); this.disposed=true; this.abort.abort(); if(this.availabilityTimer)clearInterval(this.availabilityTimer); this.buffers.clear(); this.steps.clear(); this.voiceListeners.clear(); this.master?.disconnect(); this.convolver?.disconnect(); this.wet?.disconnect(); void this.context?.close().catch(()=>{}); }
}
