// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect,vi} from 'vitest';
import {SpatialEvaluator} from './scripting-runtime.js';
import type {SpatialProgram,SpatialScope,SpatialEvent,SpatialAction} from './scripting.js';
const scope=():SpatialScope=>({rooms:new Set(['r']),zones:new Set(['z']),placements:new Set(['p']),lights:new Set(['l']),mediaAssets:new Set(['m'])});
const text=(value='Synthetic',delayMs=0):SpatialAction=>({type:'show_text',text:value,locale:'en',delayMs});
const rule=(trigger:SpatialEvent,actions:SpatialAction[]=[text()],once=false,id='rule'):SpatialProgram['rules'][number]=>({id,trigger,actions,once});
const program=(rules:SpatialProgram['rules']):SpatialProgram=>({version:1,rules});
const clock=(elapsedMs=0,wallUtcMs=Date.parse('2026-10-02T00:00:00.000Z'))=>({elapsedMs,wallUtcMs});
const allow=()=>true;
test('all normalized room zone approach look click lifecycle and custom triggers execute exact scoped actions',()=>{
 const events:SpatialEvent[]=[{type:'room_enter',roomId:'r'},{type:'room_leave',roomId:'r'},{type:'zone_enter',zoneId:'z'},{type:'zone_leave',zoneId:'z'},{type:'artwork_approach',placementId:'p'},{type:'artwork_look',placementId:'p'},{type:'artwork_click',placementId:'p'},{type:'exhibition_start'},{type:'exhibition_end'},{type:'custom_event',name:'visitor:choice'}];
 const evaluator=new SpatialEvaluator(program(events.map((e,i)=>rule(e,[text(String(i))],false,'r'+i))),scope(),allow);
 for(const [i,event]of events.entries())expect(evaluator.dispatch(event,clock(i)).actions).toEqual([text(String(i))]);
});
test('room and zone edge dedup requires leave before reentry; once rules never repeat',()=>{
 for(const [enter,leave]of [[{type:'room_enter',roomId:'r'},{type:'room_leave',roomId:'r'}],[{type:'zone_enter',zoneId:'z'},{type:'zone_leave',zoneId:'z'}]] as [SpatialEvent,SpatialEvent][]){
  const e=new SpatialEvaluator(program([rule(enter,[text('repeat')]),rule(enter,[text('once')],true,'once')]),scope(),allow);
  expect(e.dispatch(enter,clock()).actions).toHaveLength(2);expect(e.dispatch(enter,clock()).actions).toHaveLength(0);
  e.dispatch(leave,clock());expect(e.dispatch(enter,clock()).actions).toEqual([text('repeat')]);
 }
});
test('all six action variants are commands only and current capability checked for each',()=>{
 const actions:SpatialAction[]=[{type:'set_light',lightId:'l',multiplier:.4,delayMs:0},{type:'play_audio',mediaAssetId:'m',volume:.5,delayMs:0},{type:'stop_audio',mediaAssetId:'m',delayMs:0},text(),{type:'set_artwork_visibility',placementId:'p',visible:false,delayMs:0},{type:'emit_event',name:'done',delayMs:0}];
 const seen:SpatialAction[]=[];const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},actions)]),scope(),a=>{seen.push(a);return true;});
 expect(e.dispatch({type:'exhibition_start'},clock()).actions).toEqual(actions);expect(seen).toEqual(actions);
});
test('AFTER delays are cumulative; FIFO ties and stable rule order preserved',()=>{
 const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},[text('a',10),text('b',5)],false,'first'),rule({type:'exhibition_start'},[text('c',10)],false,'second')]),scope(),allow);
 expect(e.dispatch({type:'exhibition_start'},clock()).actions).toEqual([]);
 expect(e.advance(clock(9)).actions).toEqual([]);expect(e.advance(clock(10)).actions).toEqual([text('a',10),text('c',10)]);expect(e.advance(clock(15)).actions).toEqual([text('b',5)]);
});
test('equal elapsed triggers each fire once and catch-up anchors AFTER to threshold not late pump',()=>{
 const e=new SpatialEvaluator(program([rule({type:'elapsed_time',atMs:5000},[text('a',1000)],false,'one'),rule({type:'elapsed_time',atMs:5000},[text('b',1000)],false,'two')]),scope(),allow);
 expect(e.advance(clock(10000)).actions).toEqual([text('a',1000),text('b',1000)]);expect(e.advance(clock(11000)).actions).toEqual([]);
});
test('strict UTC date/time thresholds map to relative clock, initially past anchors at zero',()=>{
 const atUtc='2026-10-02T00:00:05.000Z';const e=new SpatialEvaluator(program([rule({type:'absolute_time',atUtc},[text('date',1000)])]),scope(),allow);
 expect(e.advance(clock()).actions).toEqual([]);expect(e.advance(clock(10000,Date.parse('2026-10-02T00:00:10.000Z'))).actions).toEqual([text('date',1000)]);
 const past=new SpatialEvaluator(program([rule({type:'absolute_time',atUtc},[text('past',20)])]),scope(),allow);
 expect(past.advance(clock(0,Date.parse('2026-10-02T00:00:10.000Z'))).actions).toEqual([]);expect(past.advance(clock(20,Date.parse('2026-10-02T00:00:10.020Z'))).actions).toEqual([text('past',20)]);
});
test('emit_event evaluates real matching rules with catch-up delays and deterministic order',()=>{
 const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},[{type:'emit_event',name:'next',delayMs:10}]),rule({type:'custom_event',name:'next'},[text('nested',5)],false,'next')]),scope(),allow);
 e.dispatch({type:'exhibition_start'},clock());expect(e.advance(clock(20)).actions).toEqual([{type:'emit_event',name:'next',delayMs:10},text('nested',5)]);
});
test('denied audio and missing consent emit no play command; live revocation checked at due time',()=>{
 let rights=true,consent=false;const e=new SpatialEvaluator(program([rule({type:'artwork_click',placementId:'p'},[{type:'play_audio',mediaAssetId:'m',volume:1,delayMs:5},text('read',5)])]),scope(),a=>a.type!=='play_audio'||(rights&&consent));
 e.dispatch({type:'artwork_click',placementId:'p'},clock());expect(e.advance(clock(5)).actions).toEqual([]);expect(e.snapshot().trace.at(-1)?.code).toBe('ACTION_DENIED');
 expect(e.advance(clock(10)).actions).toEqual([text('read',5)]);consent=true;
 e.dispatch({type:'artwork_click',placementId:'p'},clock(20));rights=false;expect(e.advance(clock(25)).actions).toEqual([]);
 rights=true;e.dispatch({type:'artwork_click',placementId:'p'},clock(30));expect(e.advance(clock(35)).actions).toContainEqual({type:'play_audio',mediaAssetId:'m',volume:1,delayMs:5});
});
test('denied emit event cannot trigger subordinate rules and thrown capability is fail closed',()=>{
 for(const authorize of [()=>false,()=>{throw Error('host failure');}]){const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},[{type:'emit_event',name:'next',delayMs:0}]),rule({type:'custom_event',name:'next'},[text('secret')],false,'next')]),scope(),authorize);expect(e.dispatch({type:'exhibition_start'},clock()).actions).toEqual([]);expect(e.snapshot().lifetime).toBe(1);}
 expect(()=>new SpatialEvaluator(program([]),scope(),undefined as unknown as typeof allow)).toThrow('SPATIAL_PROGRAM_INVALID');
});
test('cancel and unload retain no queue or future emitted commands',()=>{
 for(const end of ['cancel','unload'] as const){const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},[text('later',100)])]),scope(),allow);e.dispatch({type:'exhibition_start'},clock());expect(e.snapshot().pending).toBe(1);e[end]();expect(e.snapshot().pending).toBe(0);expect(e.advance(clock(100)).actions).toEqual([]);expect(e.dispatch({type:'exhibition_start'},clock(100)).actions).toEqual([]);expect(e.snapshot().reason).toBe('SPATIAL_CANCELLED');}
});
test('runaway recursion hard halts at depth eight with cleared queue and bounded trace',()=>{
 const e=new SpatialEvaluator(program([rule({type:'custom_event',name:'loop'},[{type:'emit_event',name:'loop',delayMs:0}])]),scope(),allow);
 const result=e.dispatch({type:'custom_event',name:'loop'},clock());expect(result.halted).toBe(true);expect(result.actions).toHaveLength(9);expect(e.snapshot().reason).toBe('SPATIAL_RECURSION_LIMIT');expect(e.snapshot().pending).toBe(0);expect(e.snapshot().trace.length).toBeLessThanOrEqual(128);
});
test('per-pump 64 action budget, pending256 and lifetime1024 halt rather than deferring runaway',()=>{
 const many=(count:number,delay:number)=>program(Array.from({length:count},(_,i)=>rule({type:'exhibition_start'},Array.from({length:16},()=>text('bounded',delay)),false,'r'+i)));
 const pump=new SpatialEvaluator(many(5,0),scope(),allow);expect(pump.dispatch({type:'exhibition_start'},clock()).actions).toHaveLength(64);expect(pump.snapshot().reason).toBe('SPATIAL_PUMP_LIMIT');expect(pump.snapshot().pending).toBe(0);
 const queue=new SpatialEvaluator(many(17,100),scope(),allow);expect(queue.dispatch({type:'exhibition_start'},clock()).actions).toHaveLength(0);expect(queue.snapshot().reason).toBe('SPATIAL_PENDING_LIMIT');expect(queue.snapshot().pending).toBe(0);
 const life=new SpatialEvaluator(program([rule({type:'artwork_click',placementId:'p'})]),scope(),allow);for(let i=0;i<1024;i++)expect(life.dispatch({type:'artwork_click',placementId:'p'},clock(i)).actions).toHaveLength(1);expect(life.dispatch({type:'artwork_click',placementId:'p'},clock(1024)).actions).toHaveLength(0);expect(life.snapshot().reason).toBe('SPATIAL_LIFETIME_LIMIT');expect(life.snapshot().trace).toHaveLength(128);
});
test('malformed unknown unscoped event and backward nonfinite or extra clock are refused atomically',()=>{
 const e=new SpatialEvaluator(program([rule({type:'exhibition_start'},[text('later',10)])]),scope(),allow);e.dispatch({type:'exhibition_start'},clock(5));
 for(const event of [{type:'network'},{type:'artwork_click',placementId:'private'},{type:'exhibition_start',extra:true},{type:'custom_event',name:'<script>'},null])expect(e.dispatch(event as SpatialEvent,clock(15)).actions).toEqual([]);
 for(const time of [clock(4),clock(15,0),clock(NaN),clock(Infinity),{...clock(15),extra:true}])expect(e.advance(time).actions).toEqual([]);
 expect(e.snapshot().clock).toEqual(clock(5));expect(e.advance(clock(15)).actions).toEqual([text('later',10)]);
 expect(e.dispatch({type:'elapsed_time',atMs:0},clock(15)).trace.at(-1)?.code).toBe('SPATIAL_CLOCK_EVENT_REFUSED');
});
test('input mutation, scope mutation and other visitor snapshots cannot alter evaluator state',()=>{
 const p=program([rule({type:'exhibition_start'},[text('original',5)])]),s=scope();const a=new SpatialEvaluator(p,s,allow),b=new SpatialEvaluator(p,s,allow);
 p.rules[0]!.actions[0]=text('mutated');(s.rooms as Set<string>).clear();const input=clock();a.dispatch({type:'exhibition_start'},input);input.elapsedMs=99;
 expect(a.advance(clock(5)).actions).toEqual([text('original',5)]);expect(b.snapshot().pending).toBe(0);expect(b.snapshot().lifetime).toBe(0);
 const snap=a.snapshot();expect(Object.isFrozen(snap.trace)).toBe(true);expect(()=>{snap.clock.elapsedMs=900;}).toThrow();expect(a.snapshot().clock.elapsedMs).toBe(5);
});
test('accessor cyclic exotic and oversized inputs are refused without evaluating getters',()=>{
 let reads=0;const trigger={type:'exhibition_start'};Object.defineProperty(trigger,'extra',{enumerable:true,get(){reads++;return true;}});
 const e=new SpatialEvaluator(program([]),scope(),allow);expect(e.dispatch(trigger as SpatialEvent,clock()).actions).toEqual([]);
 const time=Object.defineProperty({wallUtcMs:0},'elapsedMs',{enumerable:true,get(){reads++;return 0;}});expect(e.advance(time as ReturnType<typeof clock>).actions).toEqual([]);
 const p=program([]);Object.defineProperty(p,'extra',{enumerable:true,get(){reads++;return true;}});expect(()=>new SpatialEvaluator(p,scope(),allow)).toThrow();expect(reads).toBe(0);
 const cycle:Record<string,unknown>={};cycle.self=cycle;expect(()=>new SpatialEvaluator(cycle as unknown as SpatialProgram,scope(),allow)).toThrow();expect(()=>new SpatialEvaluator(new Date() as unknown as SpatialProgram,scope(),allow)).toThrow();
 expect(e.dispatch({type:'custom_event',name:'a'.repeat(65536)},clock()).actions).toEqual([]);
});


test('exotic array prototype inherited toJSON is rejected before invoking it',()=>{
 let calls=0;const p=program([]);Object.setPrototypeOf(p.rules,{toJSON(){calls++;return [];}});
 expect(()=>new SpatialEvaluator(p,scope(),allow)).toThrow('SPATIAL_PROGRAM_INVALID');expect(calls).toBe(0);
});
test('capability cancellation before approval prevents emitted command and clears queue',()=>{
 const e:SpatialEvaluator=new SpatialEvaluator(program([rule({type:'exhibition_start'},[text('cancelled'),text('later',10)])]),scope(),()=>{e.cancel();return true;});
 expect(e.dispatch({type:'exhibition_start'},clock()).actions).toEqual([]);expect(e.snapshot().pending).toBe(0);expect(e.snapshot().reason).toBe('SPATIAL_CANCELLED');
});
test('reentrant trusted host dispatch or advance cannot reset per-pump execution budget',()=>{
 for(const method of ['advance','dispatch'] as const){const e:SpatialEvaluator=new SpatialEvaluator(program([rule({type:'exhibition_start'})]),scope(),()=>{if(method==='advance')e.advance(clock());else e.dispatch({type:'exhibition_start'},clock());return true;});
 expect(e.dispatch({type:'exhibition_start'},clock()).actions).toEqual([]);expect(e.snapshot().reason).toBe('SPATIAL_REENTRANT');expect(e.snapshot().pending).toBe(0);}
});


test('aggregate text and sparse array bounds reject before serializing original program',()=>{
 const oversized=program(Array.from({length:32},(_,i)=>rule({type:'exhibition_start'},[text('x'.repeat(2000))],false,'r'+i)));
 const sparse=program([]);sparse.rules.length=512;
 for(const candidate of [oversized,sparse]){const original=JSON.stringify;let serialized=false,error:unknown;
  const spy=vi.spyOn(JSON,'stringify').mockImplementation((value:unknown)=>{if(value===candidate)serialized=true;return original(value);});
  try{new SpatialEvaluator(candidate,scope(),allow);}catch(caught){error=caught;}finally{spy.mockRestore();}
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('SPATIAL_PROGRAM_INVALID');expect(serialized).toBe(false);
 }
});
