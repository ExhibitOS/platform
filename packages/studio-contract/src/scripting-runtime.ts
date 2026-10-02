// SPDX-License-Identifier: AGPL-3.0-or-later
import { validateSpatialProgram, validateSpatialEvent } from './scripting.js';
import type { SpatialProgram, SpatialScope, SpatialEvent, SpatialAction } from './scripting.js';
export interface SpatialClock { elapsedMs:number; wallUtcMs:number }
export interface SpatialTrace { sequence:number; elapsedMs:number; ruleId:string|null; code:string }
export interface SpatialPumpResult { actions:readonly Readonly<SpatialAction>[]; trace:readonly Readonly<SpatialTrace>[]; halted:boolean }
interface Pending { at:number; order:number; depth:number; ruleId:string; action:SpatialAction }
const MAX_RELATIVE=315360000000,MAX_UTC=4102444800000;
function immutable<T>(value:T):T {const copy=structuredClone(value);const freeze=(v:unknown)=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};freeze(copy);return copy;}
/** Reject accessors, exotic prototypes, cycles and oversized non-JSON structures before reading values. */
function data(value:unknown,maxBytes=32768):boolean {let nodes=0,characters=0;const seen=new Set<object>();const walk=(v:unknown,depth:number):boolean=>{
 if(++nodes>8192||depth>16)return false;if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return Number.isFinite(v);if(typeof v==='string'){characters+=v.length;return characters<=maxBytes;}
 if(typeof v!=='object'||!v||seen.has(v))return false;const proto=Object.getPrototypeOf(v);if(Array.isArray(v)?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)return false;seen.add(v);
 const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);if(names.some(k=>typeof k!=='string')||names.length>(Array.isArray(v)?513:16))return false;
 if(Array.isArray(v)){const length=descriptors.length?.value;if(!Number.isInteger(length)||length<0||length>512||names.length!==length+1)return false;
  for(let i=0;i<length;i++){const d=descriptors[String(i)];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||!walk(d.value,depth+1))return false;}
 }else for(const [key,d] of Object.entries(descriptors)){characters+=key.length;if(characters>maxBytes||!d.enumerable||!Object.hasOwn(d,'value')||!walk(d.value,depth+1))return false;}
 seen.delete(v);return true;
 };try{return walk(value,0)&&new TextEncoder().encode(JSON.stringify(value)).length<=maxBytes;}catch{return false;}}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Visitor-local deterministic command evaluator. Hosts enforce current rights/consent on EVERY
 * action. It has no network, ambient clock, timers, expressions or executable script strings.
 * Input geometry/proximity/look edges are normalized by a trusted host, never inferred here. */
export class SpatialEvaluator {
 private readonly program:SpatialProgram;
 private readonly scope:SpatialScope;
 private readonly capability:(action:Readonly<SpatialAction>)=>boolean;
 private clock:SpatialClock={elapsedMs:0,wallUtcMs:0};
 private initialized=false;
 private queue:Pending[]=[];
 private order=0;
 private lifetime=0;
 private traceSequence=0;
 private history:SpatialTrace[]=[];
 private fired=new Set<string>();
 private timeFired=new Set<string>();
 private edgeState=new Map<string,boolean>();
 private pumping=false;
 private halted=false;
 private reason:string|null=null;
 constructor(program:SpatialProgram,scope:SpatialScope,capability:(action:Readonly<SpatialAction>)=>boolean) {
  this.scope={rooms:new Set(scope.rooms),zones:new Set(scope.zones),placements:new Set(scope.placements),lights:new Set(scope.lights),mediaAssets:new Set(scope.mediaAssets)};
  if(typeof capability!=='function'||!data(program)||!validateSpatialProgram(program,this.scope).valid)throw Error('SPATIAL_PROGRAM_INVALID');
  this.program=immutable(program);this.capability=capability;
 }
 private record(code:string,ruleId:string|null=null) {this.history.push({sequence:++this.traceSequence,elapsedMs:this.clock.elapsedMs,ruleId,code});if(this.history.length>128)this.history.shift();}
 private result(actions:SpatialAction[],after:number):SpatialPumpResult {return immutable({actions,trace:this.history.filter(t=>t.sequence>after),halted:this.halted});}
 private halt(reason:string) {this.halted=true;this.reason=reason;this.queue=[];this.edgeState.clear();this.record(reason);}
 private validClock(value:unknown):value is SpatialClock {return data(value,256)&&obj(value)&&exact(value,['elapsedMs','wallUtcMs'])&&typeof value.elapsedMs==='number'&&Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=this.clock.elapsedMs&&value.elapsedMs<=MAX_RELATIVE&&typeof value.wallUtcMs==='number'&&Number.isSafeInteger(value.wallUtcMs)&&value.wallUtcMs>=this.clock.wallUtcMs&&value.wallUtcMs<=MAX_UTC;}
 private validEvent(value:unknown):value is SpatialEvent {return validateSpatialEvent(value,this.scope).valid;}
 private same(a:SpatialEvent,b:SpatialEvent) {return JSON.stringify(a)===JSON.stringify(b)||Object.keys(a).every(k=>(a as unknown as Record<string,unknown>)[k]===(b as unknown as Record<string,unknown>)[k]);}
 private schedule(event:SpatialEvent,depth:number,at=this.clock.elapsedMs) {
  if(depth>8){this.halt('SPATIAL_RECURSION_LIMIT');return;}
  for(const rule of this.program.rules) {
   if(!this.same(rule.trigger,event)||(rule.once&&this.fired.has(rule.id)))continue;
   this.enqueue(rule,depth,at);if(this.halted)return;

  }
 }
 private enqueue(rule:SpatialProgram['rules'][number],depth:number,base=this.clock.elapsedMs) {
  if(rule.once&&this.fired.has(rule.id))return;this.fired.add(rule.id);this.record('RULE_TRIGGERED',rule.id);
  let at=base;
  for(const action of rule.actions){at+=action.delayMs;if(at>MAX_RELATIVE){this.halt('SPATIAL_CLOCK_OVERFLOW');return;}if(this.queue.length>=256){this.halt('SPATIAL_PENDING_LIMIT');return;}this.queue.push({at,order:++this.order,depth,ruleId:rule.id,action});}
 }
 private thresholds() {
  for(const rule of this.program.rules){if(this.timeFired.has(rule.id))continue;const t=rule.trigger;
   if((t.type==='elapsed_time'&&this.clock.elapsedMs>=t.atMs)||(t.type==='absolute_time'&&this.clock.wallUtcMs>=Date.parse(t.atUtc))){this.timeFired.add(rule.id);this.enqueue(rule,0,t.type==='elapsed_time'?t.atMs:Math.max(0,this.clock.elapsedMs-(this.clock.wallUtcMs-Date.parse(t.atUtc))));if(this.halted)return;}
  }
 }
 private pump():SpatialAction[] {
  const actions:SpatialAction[]=[];let count=0;this.pumping=true;
  try {
  while(!this.halted){this.queue.sort((a,b)=>a.at-b.at||a.order-b.order);const next=this.queue[0];if(!next||next.at>this.clock.elapsedMs)break;
   if(count>=64){this.halt('SPATIAL_PUMP_LIMIT');break;}if(this.lifetime>=1024){this.halt('SPATIAL_LIFETIME_LIMIT');break;}
   this.queue.shift();count++;this.lifetime++;
   let allowed=false;try{allowed=this.capability(immutable(next.action))===true;}catch{allowed=false;}
   if(this.halted)break;
   if(!allowed){this.record('ACTION_DENIED',next.ruleId);continue;}
   actions.push(next.action);this.record('ACTION_EMITTED',next.ruleId);
   if(next.action.type==='emit_event')this.schedule({type:'custom_event',name:next.action.name},next.depth+1,next.at);
  }
  return actions;
  } finally {this.pumping=false;}
 }
 /** Reject malformed or backward clocks atomically. Equal clocks allow additional edge events. */
 advance(clock:SpatialClock):SpatialPumpResult {const after=this.traceSequence;if(this.pumping){this.halt('SPATIAL_REENTRANT');return this.result([],after);}if(this.halted)return this.result([],after);if(!this.validClock(clock)){this.record('SPATIAL_CLOCK_INVALID');return this.result([],after);}this.clock=structuredClone(clock);this.initialized=true;this.thresholds();return this.result(this.pump(),after);}
 dispatch(event:SpatialEvent,clock:SpatialClock):SpatialPumpResult {
  const after=this.traceSequence;if(this.pumping){this.halt('SPATIAL_REENTRANT');return this.result([],after);}if(this.halted)return this.result([],after);
  if(!this.validEvent(event)){this.record('SPATIAL_EVENT_INVALID');return this.result([],after);}
  if(!this.validClock(clock)){this.record('SPATIAL_CLOCK_INVALID');return this.result([],after);}
  // Clock triggers are derived exclusively from advance/dispatch clocks, not arbitrary early host declarations.
  if(event.type==='elapsed_time'||event.type==='absolute_time'){this.record('SPATIAL_CLOCK_EVENT_REFUSED');return this.result([],after);}
  this.clock=structuredClone(clock);this.initialized=true;this.thresholds();
  if(!this.halted){let changed=true;if(event.type==='room_enter'||event.type==='room_leave'||event.type==='zone_enter'||event.type==='zone_leave'){
    const key=event.type.startsWith('room_')?'room:'+('roomId'in event?event.roomId:''):'zone:'+('zoneId'in event?event.zoneId:'');const value=event.type.endsWith('_enter');changed=this.edgeState.get(key)!==value;this.edgeState.set(key,value);
   }if(changed)this.schedule(structuredClone(event),0);else this.record('DUPLICATE_EDGE_IGNORED');}
  return this.result(this.pump(),after);
 }
 cancel():SpatialPumpResult {const after=this.traceSequence;if(!this.halted)this.halt('SPATIAL_CANCELLED');return this.result([],after);}
 unload():SpatialPumpResult {return this.cancel();}
 snapshot() {return immutable({clock:this.clock,initialized:this.initialized,halted:this.halted,reason:this.reason,pending:this.queue.length,lifetime:this.lifetime,trace:this.history});}
}
