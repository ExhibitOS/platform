// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {validateSpatialProgram,validateSpatialEvent,parseSpatialProgram,type SpatialScope,type SpatialEvent,type SpatialAction} from './scripting.js';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const Ajv=require('ajv'),formats=require('ajv-formats');
const ajv=new Ajv({allErrors:true,strict:true});formats(ajv);
const schema=ajv.compile(JSON.parse(readFileSync(new URL('../../../contracts/spatial-scripting.schema.json',import.meta.url),'utf8')));
const scope:SpatialScope={rooms:new Set(['room-a']),zones:new Set(['zone-a']),placements:new Set(['art-a']),lights:new Set(['light-a']),mediaAssets:new Set(['media-a'])};
const events:SpatialEvent[]=[{type:'room_enter',roomId:'room-a'},{type:'room_leave',roomId:'room-a'},{type:'zone_enter',zoneId:'zone-a'},{type:'zone_leave',zoneId:'zone-a'},{type:'artwork_approach',placementId:'art-a'},{type:'artwork_look',placementId:'art-a'},{type:'artwork_click',placementId:'art-a'},{type:'exhibition_start'},{type:'exhibition_end'},{type:'elapsed_time',atMs:5000},{type:'absolute_time',atUtc:'2028-02-29T12:00:00.000Z'},{type:'custom_event',name:'artist.intro'}];
const actions:SpatialAction[]=[{type:'set_light',lightId:'light-a',multiplier:.4,delayMs:0},{type:'play_audio',mediaAssetId:'media-a',volume:.8,delayMs:0},{type:'stop_audio',mediaAssetId:'media-a',delayMs:5000},{type:'show_text',text:'Original synthetic text',locale:'ko-KR',delayMs:0},{type:'set_artwork_visibility',placementId:'art-a',visible:false,delayMs:0},{type:'emit_event',name:'artist.intro',delayMs:0}];
const fixture=(trigger:unknown=events[0],acts:unknown[]=actions)=>({version:1,rules:[{id:'rule-1',trigger,actions:acts,once:false}]});
describe('standalone Spatial Scripting development contract',()=>{
 it('accepts every source event and every closed action with schema consistency',()=>{for(const event of events){const p=fixture(event);expect(validateSpatialEvent(event,scope).valid).toBe(true);expect(validateSpatialProgram(p,scope)).toEqual({valid:true,errors:[]});expect(schema(p)).toBe(true);}});
 it('accepts empty programs and exact action delay/numeric bounds',()=>{const empty={version:1,rules:[]};expect(schema(empty)).toBe(true);expect(validateSpatialProgram(empty,scope).valid).toBe(true);for(const delayMs of [0,3600000])expect(validateSpatialProgram(fixture(events[0],[{...actions[0],delayMs}]),scope).valid).toBe(true);});
 it('rejects unsupported versions, executable actions, URLs and unknown fields in both validators',()=>{
  const invalid=[{...fixture(),version:2},{...fixture(),script:'eval(1)'},fixture({type:'room_enter',roomId:'room-a',url:'https://invalid.example'}),fixture(events[0],[{type:'fetch',url:'https://invalid.example',delayMs:0}]),fixture(events[0],[{...actions[0],code:'process.exit()'}]),fixture({type:'custom_event',name:'https://invalid.example'})];
  for(const p of invalid){expect(validateSpatialProgram(p,scope).valid).toBe(false);expect(schema(p)).toBe(false);}
 });
 it('enforces exact scoped references while schema validates structure alone',()=>{
  for(const event of events.filter(e=>'roomId'in e||'zoneId'in e||'placementId'in e)){const key='roomId'in event?'roomId':'zoneId'in event?'zoneId':'placementId';const bad={...event,[key]:'UNKNOWN'};expect(schema(fixture(bad))).toBe(true);expect(validateSpatialProgram(fixture(bad),scope).valid).toBe(false);expect(validateSpatialEvent(bad,scope).valid).toBe(false);}
  for(const a of actions.filter(a=>'lightId'in a||'mediaAssetId'in a||'placementId'in a)){const key='lightId'in a?'lightId':'mediaAssetId'in a?'mediaAssetId':'placementId';expect(validateSpatialProgram(fixture(events[0],[{...a,[key]:'UNKNOWN'}]),scope).valid).toBe(false);}
  expect(validateSpatialProgram(fixture({type:'room_enter',roomId:'ROOM-A'}),scope).valid).toBe(false);
 });
 it('rejects invalid time/date and delay/numeric bounds consistently',()=>{
  for(const event of [{type:'absolute_time',atUtc:'2027-02-29T00:00:00.000Z'},{type:'absolute_time',atUtc:'2028-02-29T24:00:00.000Z'},{type:'absolute_time',atUtc:'2028-02-29T00:00:00Z'},{type:'absolute_time',atUtc:'2028-02-29T00:00:00.000+00:00'},{type:'elapsed_time',atMs:-1},{type:'elapsed_time',atMs:.1},{type:'elapsed_time',atMs:3600001}]){const p=fixture(event);expect(validateSpatialProgram(p,scope).valid).toBe(false);expect(schema(p)).toBe(false);}
  for(const delayMs of [-1,.1,3600001]){const p=fixture(events[0],[{...actions[0],delayMs}]);expect(validateSpatialProgram(p,scope).valid).toBe(false);expect(schema(p)).toBe(false);}
  for(const multiplier of [-.1,1.1]){const p=fixture(events[0],[{...actions[0],multiplier}]);expect(validateSpatialProgram(p,scope).valid).toBe(false);expect(schema(p)).toBe(false);}
 });
 it('rejects canonical UTC dates outside the runtime clock domain with inclusive endpoint acceptance',()=>{
  for(const atUtc of ['1969-12-31T23:59:59.999Z','2100-01-01T00:00:00.001Z','9999-01-01T00:00:00.000Z']){const p=fixture({type:'absolute_time',atUtc});expect(schema(p)).toBe(true);expect(validateSpatialProgram(p,scope).valid).toBe(false);}
  for(const atUtc of ['1970-01-01T00:00:00.000Z','2100-01-01T00:00:00.000Z'])expect(validateSpatialProgram(fixture({type:'absolute_time',atUtc}),scope).valid).toBe(true);
 });
 it('bounds rules/actions, distinct identity and errors',()=>{const p=fixture();const many={version:1,rules:Array.from({length:33},(_,i)=>({...p.rules[0],id:'r'+i}))};expect(schema(many)).toBe(false);expect(validateSpatialProgram(many,scope).valid).toBe(false);expect(schema(fixture(events[0],Array.from({length:17},()=>actions[0])))).toBe(false);const duplicate={version:1,rules:[p.rules[0],p.rules[0]]};expect(validateSpatialProgram(duplicate,scope).valid).toBe(false);const bad={version:1,rules:Array.from({length:32},(_,i)=>({id:'r'+i,trigger:{type:'wrong'},actions:Array.from({length:16},()=>({type:'bad',delayMs:0})),once:false}))};expect(validateSpatialProgram(bad,scope).errors.length).toBeLessThanOrEqual(32);});
 it('rejects accessors without executing them, cycles, sparse arrays and exotic objects',()=>{
  let reads=0;const accessor={rules:[]};Object.defineProperty(accessor,'version',{get(){reads++;return 1;},enumerable:true});expect(validateSpatialProgram(accessor,scope).valid).toBe(false);expect(reads).toBe(0);
  const p=fixture() as unknown as Record<string,unknown>;p.self=p;expect(validateSpatialProgram(p,scope).valid).toBe(false);
  expect(validateSpatialProgram({version:1,rules:Array(2)},scope).valid).toBe(false);expect(validateSpatialProgram(new Date(),scope).valid).toBe(false);expect(validateSpatialProgram(Object.assign(Object.create({hidden:true}),fixture()),scope).valid).toBe(false);
 });
 it('rejects NaN, non-JSON values, over-depth and unbounded strings/UTF8 size',()=>{
  for(const n of [NaN,Infinity,-Infinity])expect(validateSpatialProgram(fixture({type:'elapsed_time',atMs:n}),scope).valid).toBe(false);
  for(const p of [undefined,()=>{},Symbol('x'),BigInt(1),{version:1,rules:[],toJSON(){throw Error('must not execute');}}])expect(validateSpatialProgram(p,scope).valid).toBe(false);
  let nested:unknown={};for(let i=0;i<14;i++)nested={child:nested};expect(validateSpatialProgram(nested,scope).valid).toBe(false);
  expect(validateSpatialProgram(fixture(events[0],[{type:'show_text',text:'x'.repeat(32769),locale:'en',delayMs:0}]),scope).valid).toBe(false);
  const large=fixture(events[0],Array.from({length:8},()=>({type:'show_text',text:'한'.repeat(2000),locale:'ko',delayMs:0})));expect(schema(large)).toBe(true);expect(validateSpatialProgram(large,scope).valid).toBe(false);
 });
 it('parses bounded untrusted JSON with no program on failure and fresh valid program output',()=>{const p=fixture();const result=parseSpatialProgram(JSON.stringify(p),scope);expect(result.valid).toBe(true);expect(result.program).toEqual(p);expect(parseSpatialProgram('not JSON',scope).program).toBeUndefined();expect(parseSpatialProgram(' '.repeat(32769),scope).valid).toBe(false);expect(parseSpatialProgram(JSON.stringify({...p,code:'globalThis.fetch("bad")'}),scope).valid).toBe(false);});
});
