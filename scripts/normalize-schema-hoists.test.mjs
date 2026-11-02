// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSchemaHoists} from './normalize-schema-hoists.mjs';

async function load(source){return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);}
test('retains hoisting, initializer order and context getter behavior',async()=>{
 const source=`export function validate(data,{instancePath='',parentData,parentDataProperty,rootData=data,dynamicAnchors={}}={}){if(data){var _valid0=instancePath;}_valid0=String(_valid0);if(data){var _valid0=rootData;}return [_valid0,parentData,parentDataProperty,dynamicAnchors];}`;
 const output=normalizeSchemaHoists(source),original=(await load(source)).validate,normalized=(await load(output)).validate;
 assert.notEqual(output,source);
 for(const data of [false,true]){
  const calls=[],context=new Proxy({},{get(target,key,receiver){calls.push(String(key));return Reflect.get(target,key,receiver);}});
  const before=original(data,context),first=[...calls];calls.length=0;const after=normalized(data,context);
  assert.deepEqual(after,before);assert.deepEqual(calls,first);
 }
 for(const value of [null,undefined,'sample',42]){
  let a,b;try{a={value:original(true,value)};}catch(e){a={name:e.name,message:e.message};}
  try{b={value:normalized(true,value)};}catch(e){b={name:e.name,message:e.message};}assert.deepEqual(b,a);
 }
 const marker=Error('getter rejected'),context={get parentData(){throw marker;}};
 assert.throws(()=>original(true,context),error=>error===marker);assert.throws(()=>normalized(true,context),error=>error===marker);
});
test('refuses declaration shapes that cannot be normalized safely',()=>{
 assert.throws(()=>normalizeSchemaHoists('var _valid0=1; var _valid0=2;'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;for(var _valid0=2;_valid0<3;_valid0++){} }'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function {'),/SCHEMA_HOIST_PARSE/);
});
test('preserves prior reads, initializer throws, nested scopes and catch shadowing',async()=>{
 const cases=[
  `export function run(log){log.push(_valid0);if(true){var _valid0=1;}if(true){var _valid0=2;}return _valid0;}`,
  `export function run(log){var _valid0=1;try{throw Error('synthetic');}catch(_valid0){var _valid0=2;log.push(_valid0.message);}var _valid0=3;return _valid0;}`,
  `export function run(log){var _valid0=1;function inner(){var _valid0=4;return _valid0;}log.push(inner());var _valid0=5;return _valid0;}`,
  `export function run(log){var _valid0=1;var _valid0=(()=>{log.push('throw');throw Error('initializer');})();return _valid0;}`,
 ];
 for(const source of cases){const normalized=normalizeSchemaHoists(source),a=(await load(source)).run,b=(await load(normalized)).run;const first=[],second=[];let before,after;try{before={value:a(first)};}catch(error){before={name:error.name,message:error.message};}try{after={value:b(second)};}catch(error){after={name:error.name,message:error.message};}assert.deepEqual(after,before);assert.deepEqual(second,first);}
});
test('fails closed on unsupported uninitialized or multi-declarator duplicates',()=>{
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;var _valid0;}'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;var _valid0=2,other=3;}'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;var other=3,_valid0=2;}'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;var {x:_valid0}={x:2};}'),/SCHEMA_HOIST_SHAPE/);
 assert.throws(()=>normalizeSchemaHoists('function x(){var _valid0=1;var [..._valid0]=[2];}'),/SCHEMA_HOIST_SHAPE/);
});
