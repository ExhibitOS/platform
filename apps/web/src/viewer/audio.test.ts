// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "vitest";
import assert from "node:assert/strict";
import { distanceGain, footstepWave, StrideClock, verifyPcmWav, ExhibitionAudio } from "./audio.ts";
import type { NavigationState } from "./navigation.ts";
const state=(x:number, extra:Partial<NavigationState>={}):NavigationState=>({eyePosition:[x,1.65,0],yaw:0,velocity:[1.3,0,0],grounded:true,steps:1,paused:false,blocked:false,recovered:false,...extra});
test("distance attenuation is bounded, silence outside radius and invalid distances",()=>{assert.equal(distanceGain(0,3),1);assert.equal(distanceGain(1.5,3),0.25);assert.equal(distanceGain(3,3),0);assert.equal(distanceGain(4,3),0);assert.equal(distanceGain(NaN,3),0);assert.equal(distanceGain(1,0),0);});
test("original four floor waveforms have bounded finite distinct energy and deterministic output",()=>{const waves=["wood","stone","concrete","carpet"].map(m=>footstepWave(m as "wood",48000));for(const wave of waves){assert.ok(wave.length<10000);assert.ok(wave.every(n=>Number.isFinite(n)&&Math.abs(n)<1));}assert.notDeepEqual(waves[0],waves[1]);assert.deepEqual(waves[0],footstepWave("wood",48000));const energy=(wave:Float32Array)=>wave.reduce((n,v)=>n+v*v,0);assert.ok(energy(waves[3]!)<energy(waves[0]!));});
test("footsteps require actual grounded displacement; stationary collision and keyboard look cannot step",()=>{const clock=new StrideClock();assert.equal(clock.advance(state(0),true),false);for(let i=0;i<100;i++)assert.equal(clock.advance(state(0,{yaw:i,blocked:true}),true),false);for(let i=1;i<5;i++)assert.equal(clock.advance(state(i*.1),true),false);assert.equal(clock.advance(state(.6),true),true);assert.equal(clock.advance(state(.7,{grounded:false}),true),false);assert.equal(clock.advance(state(.8,{paused:true}),true),false);assert.equal(clock.advance(state(.9),false),false);});
test("footstep teleports and recovery reset stride; pause prevents deferred step",()=>{const clock=new StrideClock();clock.advance(state(0),true);assert.equal(clock.advance(state(10),true),false);assert.equal(clock.advance(state(10.1,{recovered:true}),true),false);clock.advance(state(10.3),true);clock.reset();assert.equal(clock.advance(state(11),true),false);});
function wav(seconds=1){const data=16000*seconds, buffer=new ArrayBuffer(44+data),view=new DataView(buffer);for(const [at,tag] of [[0,"RIFF"],[8,"WAVE"],[12,"fmt "],[36,"data"]] as const)for(let i=0;i<4;i++)view.setUint8(at+i,tag.charCodeAt(i));view.setUint32(4,buffer.byteLength-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,data,true);return buffer;}
test("WAV predecode validates actual PCM16 duration and channels",()=>{assert.deepEqual(verifyPcmWav(wav()),{channels:1,sampleRate:8000,duration:1});assert.throws(()=>verifyPcmWav(wav(61)),/AUDIO_WAV_INVALID/);const bad=wav();new DataView(bad).setUint16(34,8,true);assert.throws(()=>verifyPcmWav(bad),/AUDIO_WAV_INVALID/);assert.throws(()=>verifyPcmWav(new ArrayBuffer(10)),/AUDIO_WAV_INVALID/);});
test("WAV rejects truncated payload, false RIFF length and misleading block alignment",()=>{const bad=wav();new DataView(bad).setUint32(40,99999999,true);assert.throws(()=>verifyPcmWav(bad));const length=wav();new DataView(length).setUint32(4,123,true);assert.throws(()=>verifyPcmWav(length));const align=wav();new DataView(align).setUint16(32,4,true);assert.throws(()=>verifyPcmWav(align));});

function voiceRuntime() {
  const id="11111111-1111-4111-8111-111111111111";
  const publication={publication:{id,revisionSha256:"a".repeat(64),publishedAt:"2026-10-02",status:"published"},assets:[],exhibition:{rooms:[],extensions:{"org.exhibitos.viewer/experience":{version:1,footsteps:[],voices:[{assetId:id,placementId:id,locale:"ko",transcript:"Synthetic narration"}],annotations:[],rooms:[],translations:[]}}}} as unknown as import("../publication-client").PublicPublication;
  return {id,runtime:new ExhibitionAudio(publication,()=>{})};
}
function preparedVoice() {
  const {id,runtime}=voiceRuntime();
  let starts=0;
  const internal=runtime as unknown as {state:{enabled:boolean};context:{state:string;currentTime:number;createBufferSource:()=>AudioBufferSourceNode};master:GainNode;checkAvailability:()=>Promise<void>;load:(id:string)=>Promise<AudioBuffer>};
  internal.state.enabled=true;
  internal.master={gain:{setValueAtTime:()=>{}}} as unknown as GainNode;
  internal.context={state:"running",currentTime:0,createBufferSource:()=>({connect:()=>{},disconnect:()=>{},start:()=>{starts++;},stop:()=>{}} as unknown as AudioBufferSourceNode)};
  internal.checkAvailability=async()=>{};
  internal.load=async()=>({} as AudioBuffer);
  return {id,runtime,internal,starts:()=>starts};
}
test("voice Promise rejects missing media and autoplay refusal instead of announcing successful playback",async()=>{
  const {id,runtime}=voiceRuntime();
  await assert.rejects(runtime.playVoice("missing"),/AUDIO_MISSING/);
  // No AudioContext is available in this unit environment: the actual enable path catches refusal.
  await assert.rejects(runtime.playVoice(id),/AUDIO_BLOCKED/);
  assert.equal(runtime.snapshot().active,0);
  assert.match(runtime.snapshot().message,/재생할 수 없습니다/);
});
test("voice Promise rejects publication or verified-media failure and never starts a source",async()=>{
  for(const stage of ["checkAvailability","load"] as const){const {id,runtime,internal,starts}=preparedVoice();internal[stage]=async()=>{throw Error("SYNTHETIC_FAILURE");};await assert.rejects(runtime.playVoice(id),/SYNTHETIC_FAILURE/);assert.equal(starts(),0);assert.equal(runtime.snapshot().active,0);}
});
test("muted and hidden voice requests reject cancellation without starting or loading",async()=>{
  for(const hide of [false,true]){const {id,runtime,internal,starts}=preparedVoice();let loads=0;internal.load=async()=>{loads++;return {} as AudioBuffer;};if(hide)runtime.visibility(false);else runtime.mute(true);await assert.rejects(runtime.playVoice(id),/AUDIO_CANCELLED/);assert.equal(starts(),0);assert.equal(loads,0);}
});
test("stopping pending voice load rejects its Promise and prevents late playback",async()=>{
  const {id,runtime,internal,starts}=preparedVoice();let finish:((buffer:AudioBuffer)=>void)|undefined,loading:()=>void=()=>{};const entered=new Promise<void>(resolve=>{loading=resolve;});internal.load=()=>new Promise(resolve=>{finish=resolve;loading();});const request=runtime.playVoice(id);await entered;runtime.stopVoice();finish!({} as AudioBuffer);await assert.rejects(request,/AUDIO_CANCELLED/);assert.equal(starts(),0);assert.equal(runtime.snapshot().active,0);
});
test("voice Promise fulfills only after the actual source start call succeeds",async()=>{
  const {id,runtime,starts}=preparedVoice();await runtime.playVoice(id);assert.equal(starts(),1);assert.equal(runtime.snapshot().active,1);assert.match(runtime.snapshot().message,/재생 중/);runtime.stopVoice();assert.equal(runtime.snapshot().active,0);
});
