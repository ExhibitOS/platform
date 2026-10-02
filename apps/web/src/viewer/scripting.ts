// SPDX-License-Identifier: AGPL-3.0-or-later
import {SpatialEvaluator} from '@exhibitos/studio-contract';
import type {SpatialProgram,SpatialScope,SpatialEvent,SpatialAction} from '@exhibitos/studio-contract';
export interface ScriptScene {setLight:(id:string,multiplier:number)=>void;setArtworkVisible:(id:string,visible:boolean)=>void;reset:()=>void}
export interface ScriptHost {scene:()=>ScriptScene|null;audioAllowed:(id?:string)=>boolean;check:(signal?:AbortSignal)=>Promise<void>;playAudio:(id:string,volume:number,allowed:()=>boolean)=>Promise<void>;stopAudio:(id?:string)=>void;changed:(state:ScriptState)=>void}
export interface ScriptState {enabled:boolean;halted:boolean;pending:number;lifetime:number;text:string;status:string;trace:readonly {sequence:number;elapsedMs:number;ruleId:string|null;code:string}[];lights:Record<string,number>;visibility:Record<string,boolean>}
/** Local adapter only. Async use rechecks rights and cancellation after EVERY await. */
export class ScriptSession {
 private evaluator:SpatialEvaluator|null=null;private generation=0;private startTime=0;private lastNow=0;private rightsTime=0;private checking=false;private state:ScriptState={enabled:false,halted:false,pending:0,lifetime:0,text:'',status:'스크립트는 선택해서 시작합니다.',trace:[],lights:{},visibility:{}};
 private jobs:Promise<void>=Promise.resolve();private controller=new AbortController();private waiting=0;private lightTimes=new Map<string,number>();
 constructor(private program:SpatialProgram,private scope:SpatialScope,private host:ScriptHost){}
 snapshot(){return structuredClone(this.state);}
 private emit(){this.host.changed(this.snapshot());}
 async start(now:number,utc:number){this.stop();if(!Number.isFinite(now)||!Number.isFinite(utc))return;const generation=++this.generation;
  try{await this.host.check(this.controller.signal);if(generation!==this.generation)return;this.startTime=now;this.lastNow=now;this.rightsTime=now;this.evaluator=new SpatialEvaluator(this.program,this.scope,a=>this.state.enabled&&(a.type!=='play_audio'||this.host.audioAllowed(a.mediaAssetId)));this.state.enabled=true;this.state.halted=false;this.state.status='현재 관람객에게만 스크립트를 실행합니다.';this.event({type:'exhibition_start'},now,utc);}catch{if(generation===this.generation){this.stop();this.state.status='전시 권한을 확인할 수 없어 실행하지 않습니다.';this.emit();}}
 }
 event(event:SpatialEvent,now:number,utc:number){if(!this.state.enabled||!this.evaluator)return;this.consume(this.evaluator.dispatch(event,this.clock(now,utc)));}
 advance(now:number,utc:number){if(!this.state.enabled||!this.evaluator)return;this.consume(this.evaluator.advance(this.clock(now,utc)));
  if(this.state.enabled&&!this.checking&&now-this.rightsTime>=2000){this.rightsTime=now;this.checking=true;const generation=this.generation;void this.host.check(this.controller.signal).catch(()=>{if(generation===this.generation){this.stop();this.state.status='전시 권한 변경을 확인해 정지했습니다.';this.emit();}}).finally(()=>{if(generation===this.generation)this.checking=false;});}
 }
 private clock(now:number,utc:number){this.lastNow=Math.max(this.lastNow,now);return {elapsedMs:Math.max(0,Math.floor(this.lastNow-this.startTime)),wallUtcMs:Math.floor(utc)};}
 private consume(result:ReturnType<SpatialEvaluator['advance']>){const snap=this.evaluator!.snapshot();this.state.pending=snap.pending;this.state.lifetime=snap.lifetime;this.state.trace=snap.trace;if(result.trace.some(t=>t.code==='ACTION_DENIED'))this.state.status='허용되지 않은 동작은 생략했습니다. 소리는 원문 대본으로 읽을 수 있습니다.';
  if(result.halted){this.stop();this.state.halted=true;this.state.status='실행 한도에 도달해 스크립트와 예약 작업을 정지했습니다.';this.emit();return;}
  const generation=this.generation,signal=this.controller.signal;for(const action of result.actions){if(this.waiting>=256){this.stop();this.state.halted=true;this.state.status='비동기 실행 한도에 도달해 정지했습니다.';break;}this.waiting++;this.jobs=this.jobs.then(()=>this.apply(action,generation,signal)).catch(()=>{}).finally(()=>{if(generation===this.generation)this.waiting--;});}this.emit();
 }
 private async apply(action:Readonly<SpatialAction>,generation:number,signal:AbortSignal){const current=()=>generation===this.generation&&this.state.enabled;
  if(!current())return;try{await this.host.check(signal);if(!current())return;
   switch(action.type){case 'set_light':{const now=this.lastNow,previous=this.lightTimes.get(action.lightId);if(previous!==undefined&&now-previous<500){this.state.status='빠른 조명 변경을 줄여 깜박임을 방지했습니다.';break;}this.lightTimes.set(action.lightId,now);this.host.scene()?.setLight(action.lightId,action.multiplier);this.state.lights[action.lightId]=action.multiplier;break;}
    case 'set_artwork_visibility':this.host.scene()?.setArtworkVisible(action.placementId,action.visible);this.state.visibility[action.placementId]=action.visible;break;
    case 'show_text':this.state.text=action.text;break;
    case 'play_audio':if(this.host.audioAllowed(action.mediaAssetId))await this.host.playAudio(action.mediaAssetId,action.volume,()=>current()&&this.host.audioAllowed(action.mediaAssetId));else this.state.status='오디오 허용과 소리 켜기가 필요합니다. 원문 대본은 아래에서 읽을 수 있습니다.';break;
    case 'stop_audio':this.host.stopAudio(action.mediaAssetId);break;
    case 'emit_event':break;
   }if(current())this.emit();
  }catch{if(current()){this.stop();this.state.status='권한 또는 미디어 검사 실패로 실행과 예약 작업을 정지했습니다. 원문 대본은 유지됩니다.';this.emit();}}
 }
 stop(){++this.generation;this.controller.abort();this.controller=new AbortController();this.jobs=Promise.resolve();this.waiting=0;this.checking=false;this.evaluator?.unload();this.evaluator=null;this.host.stopAudio();this.host.scene()?.reset();this.lightTimes.clear();this.state={...this.state,enabled:false,pending:0,text:'',lights:{},visibility:{},status:'스크립트를 정지하고 원래 전시 표시로 복원했습니다.'};this.emit();}
}
