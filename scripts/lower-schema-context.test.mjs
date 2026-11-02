// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import {lowerSchemaContext} from './lower-schema-context.mjs';
const load=source=>import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const source=`export function validate1(data,{instancePath='',parentData,parentDataProperty,rootData=data,dynamicAnchors={}}={}){return [data,instancePath,rootData];}`;
test('retains one ordered property Get per field, primitive receiver, defaults and outcomes',async()=>{
 const original=(await load(source)).validate1,changed=(await load(lowerSchemaContext(source))).validate1;
 assert.equal(original.length,changed.length);
 for(const input of [undefined,{},'text',0,false,{instancePath:'/x',rootData:null}])assert.deepEqual(changed('data',input),original('data',input));
 for(const fn of [original,changed]){
  const gets=[],context=new Proxy({instancePath:'/x',rootData:'r'},{get(target,key,receiver){gets.push(String(key));return Reflect.get(target,key,receiver);}});
  assert.deepEqual(fn('data',context),['data','/x','r']);assert.deepEqual(gets,['instancePath','parentData','parentDataProperty','rootData','dynamicAnchors']);
  const getterContext={get parentData(){assert.equal(this,getterContext);return 7;}};fn('data',getterContext);
  assert.throws(()=>fn('data',null),TypeError);
  const sentinel=new Error('sentinel');assert.throws(()=>fn('data',new Proxy({},{get(_target,key){if(key==='parentDataProperty')throw sentinel;return undefined;}})),e=>e===sentinel);
 }
});
test('rejects write-only bindings, unexpected defaults and direct eval',()=>{
 assert.throws(()=>lowerSchemaContext(source.replace('return [data,instancePath,rootData];','parentData=1;return [data,instancePath,rootData];')),/SCHEMA_CONTEXT_WRITE_ONLY/);
 assert.throws(()=>lowerSchemaContext(source.replace("instancePath=''",'instancePath')),/SCHEMA_CONTEXT_DEFAULT/);
 assert.throws(()=>lowerSchemaContext(source.replace('function validate1','function* validate1')),/SCHEMA_CONTEXT_SHAPE/);
 assert.throws(()=>lowerSchemaContext(source.replace('return [data,instancePath,rootData];','function data(){};return rootData;')),/SCHEMA_CONTEXT_SCOPE/);
 assert.throws(()=>lowerSchemaContext(source+'eval("1");'),/SCHEMA_CONTEXT_EVAL/);
});
