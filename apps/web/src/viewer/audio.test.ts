// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, vi } from "vitest";
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

test("stop, pause and dispose cancel a zone requested while audio permission is pending",async()=>{
  for(const action of ["stop", "pause", "mute", "hide", "optout", "dispose"]){
    const {id,runtime,internal,starts}=preparedVoice();
    const doc=(internal as unknown as {publication:import("../publication-client").PublicPublication}).publication.exhibition;
    doc.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:3,volume:0.5,autoplay:false,transcript:"Synthetic zone"}];
    internal.state.enabled=false;
    let finish:()=>void=()=>{}, loads=0;
    runtime.enable=()=>new Promise<void>(resolve=>{finish=()=>{internal.state.enabled=true;resolve();};});
    internal.load=async()=>{loads++;return {} as AudioBuffer;};
    // Close is used only by dispose; the synthetic context has no timers or nodes.
    (internal.context as unknown as {close:()=>Promise<void>}).close=async()=>{};
    (internal.master as unknown as {disconnect:()=>void}).disconnect=()=>{};
    const request=runtime.playZone(id);
    if(action==="stop")runtime.stopZone();else if(action==="pause")runtime.lifecycle(false);else if(action==="mute")runtime.mute(true);else if(action==="hide")runtime.visibility(false);else if(action==="optout")await runtime.zoneTransitions(false);else runtime.dispose();
    finish();await request;
    assert.equal(loads,0);assert.equal(starts(),0);assert.equal(runtime.snapshot().active,0);
  }
});

test("walking availability poll stops audio and clears cache even between short footstep sources",async()=>{
  vi.useFakeTimers();
  try {
    const {runtime,internal}=preparedVoice();
    const context=internal.context as unknown as {resume:()=>Promise<void>;close:()=>Promise<void>};
    context.resume=async()=>{};context.close=async()=>{};
    (internal.master as unknown as {disconnect:()=>void}).disconnect=()=>{};
    const cache=(runtime as unknown as {buffers:Map<string,AudioBuffer>}).buffers;
    cache.set("cached",{length:8,numberOfChannels:1} as AudioBuffer);
    internal.checkAvailability=async()=>{throw Error("PUBLICATION_REVOKED");};
    await runtime.enable();runtime.lifecycle(true);
    assert.equal(runtime.snapshot().active,0);
    await vi.advanceTimersByTimeAsync(10000);
    assert.equal(runtime.snapshot().enabled,false);
    assert.equal(runtime.snapshot().suspended,true);
    assert.equal(runtime.snapshot().active,0);
    assert.equal(cache.size,0);
    assert.match(runtime.snapshot().message,/권한이 변경/);
    runtime.dispose();
  } finally {vi.useRealTimers();}
});
test("queued preload skipped after room leaves current-next set performs no request or decode",async()=>{
  const {id,runtime}=voiceRuntime();
  const internal=runtime as unknown as {state:{enabled:boolean};context:AudioContext;allowed:Set<string>;loadQueue:Promise<unknown>;load:(id:string,preload:boolean)=>Promise<AudioBuffer>};
  internal.state.enabled=true;internal.context={} as AudioContext;internal.allowed.add(id);
  let finish:()=>void=()=>{};internal.loadQueue=new Promise(resolve=>{finish=()=>resolve(undefined);});
  const request=internal.load(id,true);
  internal.allowed.clear();finish();
  await assert.rejects(request,/AUDIO_PRELOAD_STALE/);
  assert.equal(runtime.snapshot().requests,0);
  assert.equal(runtime.snapshot().decodedBytes,0);
});

test("publication availability validates the metadata JSON contract without requiring the asset-only revision header",async()=>{
  const {id,runtime}=voiceRuntime();
  const internal=runtime as unknown as {checkAvailability:()=>Promise<void>};
  const metadata={publication:{id,status:"published",revisionSha256:"a".repeat(64)}};
  try {
    vi.stubGlobal("fetch",async()=>new Response(JSON.stringify(metadata),{status:200,headers:{"content-type":"application/json"}}));
    await internal.checkAvailability();
    for(const publication of [{...metadata.publication,id:"wrong"},{...metadata.publication,status:"unpublished"},{...metadata.publication,revisionSha256:"b".repeat(64)}]){
      vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({publication}),{status:200,headers:{"x-exhibitos-publication-revision":"a".repeat(64)}}));
      await assert.rejects(internal.checkAvailability(),/PUBLICATION_UNAVAILABLE/);
    }
    vi.stubGlobal("fetch",async()=>new Response("malformed JSON",{status:200}));
    await assert.rejects(internal.checkAvailability());
    vi.stubGlobal("fetch",async()=>new Response("null",{status:200}));
    await assert.rejects(internal.checkAvailability(),/PUBLICATION_UNAVAILABLE/);
    vi.stubGlobal("fetch",async()=>new Response("",{status:404}));
    await assert.rejects(internal.checkAvailability(),/PUBLICATION_UNAVAILABLE/);
  } finally {vi.unstubAllGlobals();}
});

test("displacement-triggered footsteps cap long custom WAV playback and retain short original clip duration",()=>{
  for(const custom of [true,false]){
    const {id,runtime}=voiceRuntime();
    const internal=runtime as unknown as {state:{enabled:boolean};context:AudioContext;master:GainNode;convolver:ConvolverNode;experience:{footsteps:unknown[]};buffers:Map<string,AudioBuffer>;steps:Map<string,AudioBuffer>};
    const calls:Array<[number?,number?,number?]>=[];
    const node=()=>({connect:()=>node(),disconnect:()=>{}});
    const parameter=()=>({setValueAtTime:()=>{}});
    internal.context={state:"running",currentTime:0,listener:{positionX:parameter(),positionY:parameter(),positionZ:parameter(),forwardX:parameter(),forwardY:parameter(),forwardZ:parameter()},createGain:()=>({...node(),gain:{value:0}}),createBufferSource:()=>({...node(),start:(...args:[number?,number?,number?])=>{calls.push(args);}})} as unknown as AudioContext;
    internal.master={gain:parameter()} as unknown as GainNode;
    internal.convolver={} as ConvolverNode;
    internal.state.enabled=true;
    internal.experience.footsteps=[{surfaceId:id,material:"stone",...(custom?{assetId:id}:{})}];
    const buffer={duration:custom?60:0.19,length:custom?2880000:9120,numberOfChannels:1} as AudioBuffer;
    if(custom)internal.buffers.set(id,buffer);else internal.steps.set("stone",buffer);
    runtime.footstepsEnabled(true);runtime.lifecycle(true);
    runtime.update(state(0,{floorSurfaceId:id}));
    for(let x=.1;x<=.7;x+=.1)runtime.update(state(x,{floorSurfaceId:id}));
    assert.equal(runtime.snapshot().footsteps,1);
    assert.deepEqual(calls,[[0,0,custom?0.2:0.19]]);
  }
});

test("zone diagnostics follow actual gain at small changes and announce exact cross-room silence",()=>{
  const {id,runtime}=voiceRuntime();
  const internal=runtime as unknown as {state:{enabled:boolean;zoneGain:number};context:AudioContext;publication:import("../publication-client").PublicPublication;room:string;zone:{id:string;gain:GainNode}};
  const gains:number[]=[];
  const parameter=()=>({setValueAtTime:()=>{}});
  internal.context={currentTime:0,listener:{positionX:parameter(),positionY:parameter(),positionZ:parameter(),forwardX:parameter(),forwardY:parameter(),forwardZ:parameter()}} as unknown as AudioContext;
  internal.state.enabled=true;
  internal.publication.exhibition.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:1,volume:1,autoplay:false,transcript:"Synthetic zone"}];
  internal.room=id;
  internal.zone={id,gain:{gain:{setValueAtTime:(value:number)=>{gains.push(value);}}} as unknown as GainNode};
  runtime.update(state(.95,{eyePosition:[.95,0,0]}));
  assert(Math.abs(runtime.snapshot().zoneGain-.0025)<1e-12);
  runtime.update(state(.96,{eyePosition:[.96,0,0]}));
  assert(Math.abs(runtime.snapshot().zoneGain-.0016)<1e-12);
  internal.room="another-room";
  runtime.update(state(.96,{eyePosition:[.96,0,0]}));
  assert.equal(gains.at(-1),0);
  assert.equal(runtime.snapshot().zoneGain,0);
});


test("voice transcript clock follows AudioContext media time and stops at lifecycle cancellation",async()=>{
 const {id,runtime,internal}=preparedVoice();internal.load=async()=>({duration:12} as AudioBuffer);
 const updates:ReturnType<typeof runtime.voicePlayback>[]=[];const off=runtime.subscribeVoice(v=>updates.push(v));
 await runtime.playVoice(id);assert.equal(runtime.voicePlayback().status,"playing");
 internal.context.currentTime=3.25;assert.equal(runtime.voicePlayback().positionSeconds,3.25);
 runtime.mute(true);assert.equal(runtime.voicePlayback().status,"stopped");
 internal.context.currentTime=9;assert.equal(runtime.voicePlayback().positionSeconds,3.25);
 assert.equal(updates.at(-1)?.status,"stopped");off();
});
test("voice natural end reports decoded duration and clears playback polling",async()=>{
 const {id,runtime,internal}=preparedVoice();internal.load=async()=>({duration:4} as AudioBuffer);
 let source:AudioBufferSourceNode|undefined;const create=internal.context.createBufferSource;internal.context.createBufferSource=()=>{source=create();return source;};
 await runtime.playVoice(id);source!.onended!(new Event("ended"));
 assert.deepEqual(runtime.voicePlayback(),{assetId:id,durationSeconds:4,positionSeconds:4,status:"ended"});
 assert.equal(runtime.snapshot().active,0);
});
test("volume rejects nonfinite input instead of sending NaN into WebAudio",()=>{const {runtime}=voiceRuntime();runtime.volume(NaN);assert.equal(runtime.snapshot().volume,0);runtime.volume(Infinity);assert.equal(runtime.snapshot().volume,0);});

test("zone entry remains opt-in, transitions once on entry, stops on exit and reenters after pause",async()=>{
 const {id,runtime,internal}=preparedVoice();
 const priv=runtime as unknown as {publication:import("../publication-client").PublicPublication;room:string};
 priv.publication.exhibition.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:3,volume:.5,autoplay:false,transcript:"Synthetic readable fallback"}];priv.room=id;
 const parameter=()=>({setValueAtTime:()=>{}});(internal.context as unknown as {listener:unknown}).listener={positionX:parameter(),positionY:parameter(),positionZ:parameter(),forwardX:parameter(),forwardY:parameter(),forwardZ:parameter()};
 let starts=0,stops=0;runtime.playZone=async()=>{starts++;};const stop=runtime.stopZone.bind(runtime);runtime.stopZone=()=>{stops++;stop();};
 runtime.lifecycle(true);runtime.update(state(0,{grounded:false}));assert.equal(starts,0);
 await runtime.zoneTransitions(true);assert.equal(starts,1);
 runtime.update(state(.1,{grounded:false}));assert.equal(starts,1);
 runtime.update(state(8,{grounded:false}));assert.equal(stops,1);
 runtime.update(state(0,{grounded:false}));assert.equal(starts,2);
 runtime.lifecycle(false);runtime.lifecycle(true);runtime.update(state(0,{grounded:false}));assert.equal(starts,3);
 runtime.mute(true);runtime.update(state(0,{grounded:false}));assert.equal(starts,3);runtime.mute(false);runtime.update(state(0,{grounded:false}));assert.equal(starts,4);
 runtime.visibility(false);runtime.update(state(0,{grounded:false}));assert.equal(starts,4);runtime.visibility(true);runtime.update(state(0,{grounded:false}));assert.equal(starts,5);
 assert.equal(runtime.snapshot().zoneTransitions,true);
 await runtime.zoneTransitions(false);runtime.update(state(0,{grounded:false}));assert.equal(starts,5);
});
test("authored zone gain applies actual distance and remains bounded across room boundary",()=>{
 const {id,runtime}=voiceRuntime();const internal=runtime as unknown as {position:[number,number,number];room:string;curation:{audioZones:unknown[]};zoneGain:(zone:import("@exhibitos/spec").Exhibition["audioZones"][number],p:[number,number,number])=>number;publication:import("../publication-client").PublicPublication};
 internal.publication.exhibition.surfaces=[];internal.publication.exhibition.openings=[];
 const zone={id,roomId:id,assetId:id,position:[0,0,0],radius:20,volume:.8,autoplay:false,transcript:"Synthetic"} as const;
 internal.curation.audioZones=[{zoneId:id,referenceDistance:1,maxDistance:20,rolloff:1,occlusion:{enabled:true,closedGain:.2}}];internal.position=[2,0,0];internal.room="another-room";
 assert.equal(internal.zoneGain({...zone,position:[0,0,0]},[0,0,0]),.4);
 internal.position=[20,0,0];assert.equal(internal.zoneGain({...zone,position:[0,0,0]},[0,0,0]),0);
});


test("zone start failure clears selected gain and ID and disconnects allocated nodes",async()=>{
 const {id,runtime,internal}=preparedVoice();
 const priv=runtime as unknown as {publication:import("../publication-client").PublicPublication;room:string};
 priv.publication.exhibition.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:3,volume:.5,autoplay:false,transcript:"Synthetic fallback"}];priv.room=id;
 let sourceDisconnected=0,gainDisconnected=0,pannerDisconnected=0,stops=0;
 const context=internal.context as unknown as {createBufferSource:()=>AudioBufferSourceNode;createGain:()=>GainNode;createPanner:()=>PannerNode};
 context.createBufferSource=()=>({connect:()=>panner,disconnect:()=>{sourceDisconnected++;},start:()=>{throw Error("SOURCE_START_FAILED");},stop:()=>{stops++;}} as unknown as AudioBufferSourceNode);
 const gain={gain:{value:0},connect:()=>gain,disconnect:()=>{gainDisconnected++;}};context.createGain=()=>gain as unknown as GainNode;
 const panner={positionX:{value:0},positionY:{value:0},positionZ:{value:0},connect:()=>gain,disconnect:()=>{pannerDisconnected++;}};context.createPanner=()=>panner as unknown as PannerNode;
 await runtime.playZone(id);
 assert.equal(runtime.snapshot().active,0);assert.equal(runtime.snapshot().zoneId,null);assert.equal(runtime.snapshot().zoneGain,0);
 assert.match(runtime.snapshot().message,/재생할 수 없습니다/);
 assert.equal(stops,1);assert.ok(sourceDisconnected>0);assert.equal(gainDisconnected,1);assert.equal(pannerDisconnected,1);
});


function scriptRuntime(){const fixture=preparedVoice(),{internal,id}=fixture;const doc=(internal as unknown as {publication:import("../publication-client").PublicPublication}).publication;doc.exhibition.mediaAssets=[{id,mime:'audio/wav'}] as typeof doc.exhibition.mediaAssets;doc.assets=[{assetId:id}] as typeof doc.assets;const gain={gain:{value:0},connect:()=>gain,disconnect:()=>{}};(internal.context as unknown as {createGain:()=>GainNode}).createGain=()=>gain as unknown as GainNode;internal.context.createBufferSource=()=>({connect:()=>gain,disconnect:()=>{},start:()=>{},stop:()=>{}} as unknown as AudioBufferSourceNode);internal.load=async()=>({duration:1} as AudioBuffer);return fixture;}
test('script audio requires existing sound opt-in and consent and never creates a context',async()=>{const {runtime,id,internal}=scriptRuntime();await assert.rejects(runtime.playScriptAudio(id,1,()=>false),/SCRIPT_AUDIO_DENIED/);internal.state.enabled=false;await assert.rejects(runtime.playScriptAudio(id,1,()=>true),/SCRIPT_AUDIO_DENIED/);assert.equal(runtime.snapshot().active,0);});
test('stopping script audio while its verified load pending prevents late start and preserves ordinary voice',async()=>{const {runtime,id,internal}=scriptRuntime();await runtime.playVoice(id);let finish:(buffer:AudioBuffer)=>void=()=>{},entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve;});internal.load=()=>new Promise(resolve=>{finish=resolve;entered();});const request=runtime.playScriptAudio(id,1,()=>true);await ready;runtime.stopScriptAudio(id);finish({duration:1} as AudioBuffer);await assert.rejects(request,/AUDIO_CANCELLED/);assert.equal(runtime.voicePlayback().status,'playing');assert.equal(runtime.snapshot().active,1);runtime.stopVoice();});
test('targeted script audio stop removes only matching sources while mute removes all',async()=>{const {runtime,id,internal}=scriptRuntime();const other='22222222-2222-4222-8222-222222222222';const publication=(internal as unknown as {publication:import("../publication-client").PublicPublication}).publication;publication.exhibition.mediaAssets.push({...publication.exhibition.mediaAssets[0]!,id:other});publication.assets.push({...publication.assets[0]!,assetId:other});(runtime as unknown as {experience:{voices:{assetId:string;placementId:string;transcript:string}[]}}).experience.voices.push({assetId:other,placementId:id,transcript:'Other synthetic transcript'});await runtime.playScriptAudio(id,.5,()=>true);await runtime.playScriptAudio(other,.5,()=>true);assert.equal(runtime.snapshot().active,2);runtime.stopScriptAudio(id);assert.equal(runtime.snapshot().active,1);runtime.mute(true);assert.equal(runtime.snapshot().active,0);});

test('script audio without authored readable transcript association is denied before media loading',async()=>{const {runtime,id,internal}=scriptRuntime();(runtime as unknown as {experience:{voices:unknown[]}}).experience.voices=[];let loads=0;internal.load=async()=>{loads++;return {} as AudioBuffer;};await assert.rejects(runtime.playScriptAudio(id,1,()=>true),/SCRIPT_AUDIO_TRANSCRIPT_MISSING/);assert.equal(loads,0);assert.equal(runtime.snapshot().active,0);});

function preparedShortStep(duration=.7){
 const {id,runtime}=voiceRuntime(),calls:number[][]=[],envelope:number[][]=[],sources:Array<{stopped:boolean;onended:((event:Event)=>void)|null}>=[];
 const parameter=()=>({value:0,setValueAtTime:(...v:number[])=>envelope.push(v),linearRampToValueAtTime:(...v:number[])=>envelope.push(v)});
 const node=()=>({connect:()=>node(),disconnect:()=>{}});
 const internal=runtime as unknown as {state:{enabled:boolean};context:AudioContext;master:GainNode;convolver:ConvolverNode;experience:{footsteps:unknown[]};buffers:Map<string,AudioBuffer>;publication:import('../publication-client').PublicPublication};
 internal.context={state:'running',currentTime:2,close:async()=>{},listener:{positionX:parameter(),positionY:parameter(),positionZ:parameter(),forwardX:parameter(),forwardY:parameter(),forwardZ:parameter()},createGain:()=>({...node(),gain:parameter()}),createBufferSource:()=>{const source={...node(),playbackRate:{value:1},stopped:false,onended:null,start:(...args:number[])=>calls.push(args),stop:()=>{source.stopped=true;}};sources.push(source);return source;}} as unknown as AudioContext;
 internal.master={...node(),gain:parameter()} as unknown as GainNode;internal.convolver={disconnect:()=>{}} as ConvolverNode;internal.state.enabled=true;
 internal.experience.footsteps=[{surfaceId:id,material:'wood',assetId:id}];internal.buffers.set(id,{duration,length:Math.round(duration*48000),numberOfChannels:1} as AudioBuffer);runtime.footstepsEnabled(true);
 const stride=()=>{runtime.update(state(0,{floorSurfaceId:id}));for(let x=.1;x<=.7;x+=.1)runtime.update(state(x,{floorSurfaceId:id}));};
 return {id,runtime,internal,calls,envelope,sources,stride};
}
test('short verified authored step retains its own natural duration and per-clip envelope',()=>{
 const {runtime,calls,envelope,stride}=preparedShortStep();runtime.lifecycle(true);stride();
 assert.equal(runtime.snapshot().footsteps,1);assert.deepEqual(calls,[[0,0,.7]]);assert(envelope.some(v=>v[0]===0&&typeof v[1]==='number'&&v[1]>2.6));runtime.dispose();
});
test('recorded step bank selects distinct loaded buffers with their natural ends and keeps visitor stop',()=>{
 const {id,runtime,internal,calls,sources,stride}=preparedShortStep(),other='second-step';
 internal.experience.footsteps=[{surfaceId:id,material:'wood',bank:[{assetId:id},{assetId:other}]}];internal.buffers.set(other,{duration:1.2,length:57600,numberOfChannels:1}as AudioBuffer);
 const random=vi.spyOn(Math,'random').mockReturnValue(0);
 try{runtime.lifecycle(true);stride();stride();stride();assert.deepEqual(calls.map(c=>c[2]),[.7,1.2,.7]);runtime.footstepsEnabled(false);assert(sources.every(s=>s.stopped));stride();assert.equal(calls.length,3);}finally{runtime.dispose();random.mockRestore();}
});
test('recorded step bank excludes unqualified long recordings rather than truncating them into steps',()=>{
 const {id,runtime,internal,calls,stride}=preparedShortStep(),long='full-recording';
 internal.experience.footsteps=[{surfaceId:id,material:'wood',bank:[{assetId:id},{assetId:long}]}];internal.buffers.set(long,{duration:60,length:2880000,numberOfChannels:1}as AudioBuffer);
 runtime.lifecycle(true);stride();assert.deepEqual(calls,[[0,0,.7]]);assert.match(runtime.snapshot().message,/길이/);runtime.dispose();
});
test('recorded step bank preloads current floor ahead of eight other assets and refills a same-room floor change',async()=>{
 const {id,runtime,internal}=preparedShortStep();
 const audio=runtime as unknown as {allowed:Set<string>;pending:Map<string,Promise<AudioBuffer>>;preload:()=>void;load:(id:string,preload?:boolean)=>Promise<AudioBuffer>;setRoom:(id:string)=>void;publication:import('../publication-client').PublicPublication};
 const ids=Array.from({length:16},(_,i)=>`sample-${i}`),other=['other-a','other-b'],requested:string[]=[];
 internal.experience.footsteps=[{surfaceId:id,material:'wood',bank:ids.map(assetId=>({assetId}))},{surfaceId:'other-floor',material:'stone',bank:other.map(assetId=>({assetId}))}];
 audio.publication.exhibition.rooms=[{id:'room'}] as import('@exhibitos/spec').Exhibition['rooms'];audio.publication.exhibition.audioZones=Array.from({length:8},(_,i)=>({assetId:`zone-${i}`,roomId:'room'})) as import('@exhibitos/spec').Exhibition['audioZones'];audio.publication.exhibition.surfaces=[{id,roomId:'room'},{id:'other-floor',roomId:'room'}]as import('@exhibitos/spec').Exhibition['surfaces'];audio.publication.exhibition.placements=[];
 internal.state.enabled=false;audio.setRoom('room');internal.state.enabled=true;internal.buffers.clear();
 audio.load=async assetId=>{requested.push(assetId);const b={duration:.2,length:9600,numberOfChannels:1}as AudioBuffer;internal.buffers.set(assetId,b);return b;};
 runtime.lifecycle(true);runtime.update(state(0,{roomId:'room',floorSurfaceId:id}));await Promise.resolve();assert.deepEqual(requested,ids.slice(0,8));
 for(let n=0;n<9;n++){runtime.update(state(0,{roomId:'room',floorSurfaceId:id}));for(let x=.1;x<=.7;x+=.1)runtime.update(state(x,{roomId:'room',floorSurfaceId:id}));}await Promise.resolve();assert(ids.every(assetId=>requested.includes(assetId)));
 requested.length=0;runtime.update(state(0,{roomId:'room',floorSurfaceId:'other-floor'}));await Promise.resolve();assert.deepEqual(requested.slice(0,2),other);
 internal.buffers.delete(other[0]!);audio.pending=new Map(Array.from({length:8},(_,i)=>[`held-${i}`,new Promise<AudioBuffer>(()=>{})]));requested.length=0;audio.preload();assert.equal(requested.length,0);audio.pending.clear();runtime.dispose();
});
test('visitor footsteps off stops active step sources and resets distance without enabling audio or changing zone consent',()=>{
 const {runtime,calls,sources,stride}=preparedShortStep();runtime.lifecycle(true);stride();runtime.footstepsEnabled(false);
 assert.equal(sources[0]!.stopped,true);assert.equal(runtime.snapshot().active,0);assert.equal(runtime.snapshot().footstepsEnabled,false);assert.equal(runtime.snapshot().zoneTransitions,false);
 stride();assert.equal(calls.length,1);runtime.footstepsEnabled(true);assert.equal(calls.length,1);
 runtime.update(state(.8));assert.equal(calls.length,1);runtime.visibility(false);stride();assert.equal(calls.length,1);
 const fresh=voiceRuntime().runtime;fresh.footstepsEnabled(false);assert.equal(fresh.snapshot().enabled,false);assert.equal(fresh.snapshot().context,'not-created');
});
test('room admission retains the cache buffer of an active step until its source ends',()=>{
 const {id,runtime,internal,stride}=preparedShortStep();runtime.lifecycle(true);stride();
 internal.publication.exhibition.rooms=[{id:'room-a'},{id:'room-b'}] as import('@exhibitos/spec').Exhibition['rooms'];internal.publication.exhibition.audioZones=[];internal.publication.exhibition.placements=[];internal.publication.exhibition.surfaces=[];
 const setRoom=(runtime as unknown as {setRoom:(id:string)=>void}).setRoom.bind(runtime);setRoom('room-a');assert.equal(internal.buffers.has(id),true);
 runtime.footstepsEnabled(false);setRoom('room-b');assert.equal(internal.buffers.has(id),false);
});

function voicePriorityRuntime() {
 const {id,runtime}=voiceRuntime();
 const parameter=()=>({value:1,targets:[] as number[][],envelope:[] as number[][],
  setValueAtTime(value:number,time:number){this.value=value;this.envelope.push([value,time]);},
  linearRampToValueAtTime(value:number,time:number){this.envelope.push([value,time]);},
  setTargetAtTime(value:number,time:number,constant:number){this.targets.push([value,time,constant]);}});
 const node=()=>({connections:[] as object[],disconnected:false,gain:parameter(),playbackRate:{value:1},
  positionX:parameter(),positionY:parameter(),positionZ:parameter(),onended:null as ((event:Event)=>void)|null,
  stopped:false,connect(target:object){this.connections.push(target);return target;},
  disconnect(target?:object){if(target)this.connections=this.connections.filter(value=>value!==target);else{this.connections=[];this.disconnected=true;}},stop(){this.stopped=true;},start(){if(failStart)throw Error('SYNTHETIC_START_FAILURE');}});
 let failStart=false;
 const sources:ReturnType<typeof node>[]=[];
 let impulseBuffers=0,convolvers=0;
 const context={state:'running',currentTime:2,sampleRate:48000,destination:node(),resume:async()=>{},close:async()=>{},
  listener:{positionX:parameter(),positionY:parameter(),positionZ:parameter(),forwardX:parameter(),forwardY:parameter(),forwardZ:parameter()},
  createGain:node,createConvolver:()=>{convolvers++;return node();},createBuffer:(channels:number,length:number,rate:number)=>{impulseBuffers++;return {length,numberOfChannels:channels,sampleRate:rate,duration:length/rate,getChannelData:()=>new Float32Array(length),copyFromChannel:()=>{},copyToChannel:()=>{}};},createPanner:node,createBufferSource:()=>{const s=node();sources.push(s);return s;}};
 const internal=runtime as unknown as {context:AudioContext;master:ReturnType<typeof node>;background:ReturnType<typeof node>;wet:ReturnType<typeof node>;convolver:ReturnType<typeof node>;
  load:(id:string)=>Promise<AudioBuffer>;checkAvailability:()=>Promise<void>;room:string;
  buffers:Map<string,AudioBuffer>;experience:{footsteps:unknown[]};publication:import('../publication-client').PublicPublication};
 internal.context=context as unknown as AudioContext;
 internal.checkAvailability=async()=>{};internal.load=async()=>({duration:.7} as AudioBuffer);
 internal.publication.exhibition.audioZones=[];
 internal.publication.exhibition.surfaces=[];internal.publication.exhibition.placements=[];
 internal.publication.exhibition.rooms=[{id,dimensions:{width:4,height:3,depth:4},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}] as import('@exhibitos/spec').Exhibition['rooms'];
 const enable=async()=>{internal.room=id;await runtime.enable();};
 return {id,runtime,internal,context,sources,enable,impulseBuffers:()=>impulseBuffers,convolvers:()=>convolvers,failStart:()=>{failStart=true;}};
}

test('voice priority routes active dry steps, zones and wet tails through one bus while voice bypasses it',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();const random=vi.spyOn(Math,'random').mockReturnValue(.5);
 try{
  f.runtime.footstepsEnabled(true);f.runtime.reverbEnabled(true);
  await f.enable();const {internal,runtime,id,sources}=f;
  assert.deepEqual(internal.background.connections,[internal.master]);
  assert.deepEqual(internal.convolver.connections,[internal.wet]);assert.deepEqual(internal.wet.connections,[internal.background]);
  internal.publication.exhibition.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:3,volume:.5,autoplay:false,transcript:'Synthetic zone'}];
  await runtime.playZone(id);const panner=sources[0]!.connections[0] as typeof internal.background;
  const zoneGain=panner.connections[0] as typeof internal.background;
  assert.deepEqual(zoneGain.connections,[internal.background,internal.convolver]);
  internal.experience.footsteps=[{surfaceId:id,material:'wood',assetId:id}];internal.buffers.set(id,{duration:.7,length:33600,numberOfChannels:1} as AudioBuffer);
  runtime.lifecycle(true);runtime.update(state(0,{floorSurfaceId:id}));runtime.update(state(.3,{floorSurfaceId:id}));runtime.update(state(.6,{floorSurfaceId:id}));
  const step=sources[1]!,stepGain=step.connections[0] as typeof internal.background;
  assert.deepEqual(stepGain.connections,[internal.background,internal.convolver]);
  await runtime.playVoice(id);assert.deepEqual(sources[2]!.connections,[internal.master]);
  assert.equal(step.stopped,false);assert.equal(sources[0]!.stopped,false);
  assert.deepEqual(internal.background.gain.targets.at(-1),[.35,2,.03]);
  runtime.update(state(.9,{floorSurfaceId:id}));runtime.update(state(1.2,{floorSurfaceId:id}));const speakingStepGain=sources[3]!.connections[0] as typeof internal.background;
  assert(speakingStepGain.gain.envelope.some(([value])=>value===.35)); // Envelope is not ducked a second time.
  f.context.currentTime=3;sources[2]!.onended!(new Event('ended'));
  assert.deepEqual(internal.background.gain.targets.at(-1),[1,3,.12]);assert.equal(runtime.voicePlayback().status,'ended');
 }finally{f.runtime.dispose();random.mockRestore();vi.useRealTimers();}
});

test('voice priority replacement ignores old source end events and restores only when the current voice stops',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();
 try{
  await f.enable();await f.runtime.playVoice(f.id);const ended=f.sources[0]!.onended!;
  await f.runtime.playVoice(f.id);const count=f.internal.background.gain.targets.length;
  ended(new Event('ended'));assert.equal(f.internal.background.gain.targets.length,count);
  assert.equal(f.runtime.voicePlayback().status,'playing');assert.deepEqual(f.internal.background.gain.targets.at(-1),[.35,2,.03]);
  f.runtime.stopVoice();assert.deepEqual(f.internal.background.gain.targets.at(-1),[1,2,.12]);assert(f.sources[1]!.stopped);
 }finally{f.runtime.dispose();vi.useRealTimers();}
});

test('voice priority rejects failed starts, loads and availability without ducking background',async()=>{
 vi.useFakeTimers();
 try{for(const stage of ['start','load','availability']){
  const f=voicePriorityRuntime();try{
   await f.enable();if(stage==='start')f.failStart();else if(stage==='load')f.internal.load=async()=>{throw Error('SYNTHETIC_FAILURE');};else f.internal.checkAvailability=async()=>{throw Error('SYNTHETIC_FAILURE');};
   await assert.rejects(f.runtime.playVoice(f.id),/SYNTHETIC/);
   assert(!f.internal.background.gain.targets.some(([value])=>value===.35));assert.equal(f.runtime.snapshot().active,0);
  }finally{f.runtime.dispose();}
 }}finally{vi.useRealTimers();}
});

test('voice priority late cancelled request failure cannot restore background over a newer voice',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();
 try{
  await f.enable();let reject:(error:Error)=>void=()=>{},entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve;});
  f.internal.load=()=>new Promise((_resolve,fail)=>{reject=fail;entered();});
  const old=f.runtime.playVoice(f.id);const rejected=assert.rejects(old,/OLD_REQUEST_FAILURE/);await ready;
  f.internal.load=async()=>({duration:.7} as AudioBuffer);await f.runtime.playVoice(f.id);
  const count=f.internal.background.gain.targets.length;reject(Error('OLD_REQUEST_FAILURE'));await rejected;
  assert.equal(f.internal.background.gain.targets.length,count);assert.equal(f.runtime.voicePlayback().status,'playing');
 }finally{f.runtime.dispose();vi.useRealTimers();}
});

test('voice priority cancelled pending load never ducks and lifecycle controls retain master silence',async()=>{
 vi.useFakeTimers();
 try{for(const action of ['stop','pause','mute','hide','dispose']){
  const f=voicePriorityRuntime();try{
   await f.enable();await f.runtime.playVoice(f.id);
   if(action==='stop')f.runtime.stopVoice();else if(action==='pause')f.runtime.lifecycle(false);else if(action==='mute')f.runtime.mute(true);else if(action==='hide')f.runtime.visibility(false);else f.runtime.dispose();
   assert(f.sources[0]!.stopped);assert.deepEqual(f.internal.background.gain.targets.at(-1),[1,2,.12]);
   if(action!=='stop')assert.equal(f.internal.master.gain.value,0);
   if(action==='dispose')assert(f.internal.background.disconnected);
  }finally{f.runtime.dispose();}
 }
 const f=voicePriorityRuntime();try{
  await f.enable();let finish:(buffer:AudioBuffer)=>void=()=>{},entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve;});
  f.internal.load=()=>new Promise(resolve=>{finish=resolve;entered();});const request=f.runtime.playVoice(f.id);await ready;f.runtime.stopVoice();finish({duration:.7} as AudioBuffer);
  await assert.rejects(request,/AUDIO_CANCELLED/);assert(!f.internal.background.gain.targets.some(([value])=>value===.35));assert.equal(f.sources.length,0);
 }finally{f.runtime.dispose();}
 }finally{vi.useRealTimers();}
});


test('global sound enable leaves optional footsteps, room reverb and zone automation off without idle FX loading',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();
 try{
  const {runtime,internal,id}=f,doc=internal.publication.exhibition;
  const step='step-only',zone='zone-only',loads:string[]=[];
  doc.surfaces=[{id:'floor',roomId:id}] as typeof doc.surfaces;
  doc.placements=[{id,roomId:id}] as typeof doc.placements;
  doc.audioZones=[{id:'zone',roomId:id,assetId:zone,position:[0,0,0],radius:3,volume:.5,autoplay:false,transcript:'Synthetic zone'}];
  internal.experience.footsteps=[{surfaceId:'floor',material:'wood',assetId:step}];
  const rooms=(internal as unknown as {experience:{rooms:{roomId:string;reverb:number}[]}}).experience.rooms;
  rooms.push({roomId:id,reverb:.7});const authored=JSON.stringify({rooms,footsteps:internal.experience.footsteps});
  internal.load=async assetId=>{loads.push(assetId);return {duration:.7} as AudioBuffer;};
  assert.equal(runtime.snapshot().footstepsEnabled,false);assert.equal(runtime.snapshot().reverbEnabled,false);
  await f.enable();runtime.lifecycle(true);runtime.update(state(0,{roomId:id,floorSurfaceId:'floor'}));
  for(let x=.1;x<=.7;x+=.1)runtime.update(state(x,{roomId:id,floorSurfaceId:'floor'}));
  assert.equal(runtime.snapshot().footsteps,0);assert.equal(runtime.snapshot().zoneTransitions,false);
  assert.equal(runtime.snapshot().reverbSeconds,0);assert.equal(f.impulseBuffers(),0);assert.equal(f.convolvers(),0);
  assert(loads.includes(id));assert(!loads.includes(step));assert(!loads.includes(zone));
  assert.equal(JSON.stringify({rooms,footsteps:internal.experience.footsteps}),authored);
  assert.doesNotMatch(runtime.snapshot().message,/걷기에서 발소리/);
  await runtime.playVoice(id);assert.equal(runtime.voicePlayback().status,'playing');
  assert.deepEqual(f.sources.at(-1)!.connections,[internal.master]);assert.equal(runtime.snapshot().footstepsEnabled,false);
 }finally{f.runtime.dispose();vi.useRealTimers();}
});

test('visitor reverb opt-in is independent, lazy and clears wet tails without stopping required narration',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();
 try{
  const {runtime,internal,id}=f;
  runtime.reverbEnabled(true);assert.equal(f.impulseBuffers(),0);assert.equal(runtime.snapshot().enabled,false);
  await f.enable();assert.equal(f.impulseBuffers(),1);assert.equal(runtime.snapshot().footstepsEnabled,false);
  internal.publication.exhibition.audioZones=[{id,roomId:id,assetId:id,position:[0,0,0],radius:3,volume:.5,autoplay:false,transcript:'Synthetic zone'}];
  await runtime.playZone(id);await runtime.playVoice(id);
  const voice=f.sources.at(-1)!,zone=f.sources[0]!,panner=zone.connections[0] as typeof internal.background;
  const gain=panner.connections[0] as typeof internal.background,convolver=internal.convolver,wet=internal.wet;
  assert(gain.connections.includes(convolver));assert.equal(voice.stopped,false);
  runtime.reverbEnabled(false);assert.equal(runtime.snapshot().reverbSeconds,0);
  assert.equal(wet.gain.value,0);assert.equal((convolver as unknown as {buffer:AudioBuffer|null}).buffer,null);
  assert.deepEqual(gain.connections,[internal.background]);assert.equal(voice.stopped,false);assert.equal(zone.stopped,false);
  assert.equal(runtime.voicePlayback().status,'playing');assert.equal(runtime.snapshot().zoneTransitions,false);
  assert.deepEqual(internal.background.gain.targets.at(-1),[.35,2,.03]);
  const count=f.impulseBuffers();runtime.update(state(0,{roomId:id}));assert.equal(f.impulseBuffers(),count);
  runtime.reverbEnabled(true);assert.equal(f.impulseBuffers(),count+1);assert.notEqual(internal.convolver,convolver);
  assert(gain.connections.includes(internal.convolver));assert.equal(voice.stopped,false);
 }finally{f.runtime.dispose();vi.useRealTimers();}
});

test('footsteps require their own opt-in and off drains active steps and old wet tails while preserving voice',async()=>{
 vi.useFakeTimers();const f=voicePriorityRuntime();
 try{
  const {runtime,internal,id}=f;await f.enable();
  internal.experience.footsteps=[{surfaceId:id,material:'wood',assetId:id}];
  internal.publication.exhibition.surfaces=[{id,roomId:id}] as typeof internal.publication.exhibition.surfaces;
  internal.buffers.set(id,{duration:.7,length:33600,numberOfChannels:1} as AudioBuffer);
  runtime.footstepsEnabled(true);runtime.reverbEnabled(true);runtime.lifecycle(true);
  runtime.update(state(0,{roomId:id,floorSurfaceId:id}));runtime.update(state(.3,{roomId:id,floorSurfaceId:id}));runtime.update(state(.6,{roomId:id,floorSurfaceId:id}));
  assert.equal(runtime.snapshot().footsteps,1);const step=f.sources[0]!,oldConvolver=internal.convolver,oldWet=internal.wet;
  await runtime.playVoice(id);const voice=f.sources.at(-1)!;
  runtime.footstepsEnabled(false);assert.equal(step.stopped,true);assert.equal(voice.stopped,false);
  assert.equal(oldWet.gain.value,0);assert.equal((oldConvolver as unknown as {buffer:AudioBuffer|null}).buffer,null);
  assert.equal(runtime.voicePlayback().status,'playing');assert.equal(runtime.snapshot().reverbEnabled,true);
  runtime.update(state(.9,{roomId:id,floorSurfaceId:id}));assert.equal(runtime.snapshot().footsteps,1);
  runtime.reverbEnabled(false);runtime.lifecycle(false);assert.equal(runtime.snapshot().active,0);
  assert.equal(runtime.snapshot().reverbSeconds,0);
 }finally{f.runtime.dispose();vi.useRealTimers();}
});

test('footstep opt-out invalidates queued preloads before any request or decode',async()=>{
 const {runtime,internal,id}=preparedShortStep();
 const audio=runtime as unknown as {loadQueue:Promise<unknown>;load:(id:string,preload:boolean)=>Promise<AudioBuffer>;setRoom:(id:string)=>void};
 internal.publication.exhibition.rooms=[{id:'room'}] as import('@exhibitos/spec').Exhibition['rooms'];
 internal.publication.exhibition.surfaces=[{id,roomId:'room'}] as import('@exhibitos/spec').Exhibition['surfaces'];
 internal.publication.exhibition.audioZones=[];internal.publication.exhibition.placements=[];
 internal.state.enabled=false;audio.setRoom('room');internal.state.enabled=true;
 internal.buffers.clear();let finish:()=>void=()=>{};audio.loadQueue=new Promise(resolve=>{finish=()=>resolve(undefined);});
 const pending=audio.load(id,true);runtime.footstepsEnabled(false);finish();
 await assert.rejects(pending,/AUDIO_PRELOAD_STALE/);assert.equal(runtime.snapshot().requests,0);runtime.dispose();
});

test('audio settings render optional effects unchecked when no state exists',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');
 const {AudioControls}=await import('./AudioControls');
 const html=renderToStaticMarkup(createElement(AudioControls,{audio:null,state:null,zones:[]}));
 assert(!html.includes('checked='));assert.match(html,/발소리 \(걸을 때, 선택\)/);assert.match(html,/방 잔향/);
});


test('same-room footsteps lazily restore opted-in reverb after mute or visibility suspension',async()=>{
 vi.useFakeTimers();
 try{for(const action of ['mute','visibility']){
  const f=voicePriorityRuntime();
  try{
   const {runtime,internal,id}=f;await f.enable();
   internal.experience.footsteps=[{surfaceId:id,material:'wood',assetId:id}];
   internal.publication.exhibition.surfaces=[{id,roomId:id}] as typeof internal.publication.exhibition.surfaces;
   internal.buffers.set(id,{duration:.7,length:33600,numberOfChannels:1} as AudioBuffer);
   runtime.footstepsEnabled(true);runtime.reverbEnabled(true);runtime.lifecycle(true);
   const move=(x:number)=>runtime.update(state(x,{roomId:id,floorSurfaceId:id}));
   move(0);move(.3);move(.6);const old=internal.convolver;
   assert.equal(runtime.snapshot().footsteps,1);
   if(action==='mute')runtime.mute(true);else runtime.visibility(false);
   assert.equal(runtime.snapshot().reverbEnabled,true);assert.equal(runtime.snapshot().reverbSeconds,0);
   assert.equal((old as unknown as {buffer:AudioBuffer|null}).buffer,null);
   const count=f.impulseBuffers();
   if(action==='mute')runtime.mute(false);else runtime.visibility(true);
   // Merely returning visibility or clearing mute is not a new audio gesture/source.
   assert.equal(f.impulseBuffers(),count);
   move(.7);move(1);move(1.3);
   assert.equal(runtime.snapshot().footsteps,2);assert.equal(f.impulseBuffers(),count+1);
   assert.notEqual(internal.convolver,old);assert(runtime.snapshot().reverbSeconds>0);
   const gain=f.sources.at(-1)!.connections[0] as typeof internal.background;
   assert(gain.connections.includes(internal.convolver));assert.equal(runtime.snapshot().zoneTransitions,false);
  }finally{f.runtime.dispose();}
 }}finally{vi.useRealTimers();}
});
