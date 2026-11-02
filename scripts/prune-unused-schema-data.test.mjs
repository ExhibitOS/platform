// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneUnusedSchemaData} from './prune-unused-schema-data.mjs';

async function load(source){return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);}
test('removes only unused static schema data and a redundant strict expression',async()=>{
 const source=`"use strict";const schema1={nested:[null,true,false,-3,{text:'sample'}]};const schema2={answer:42};export function value(){return schema2.answer;}`;
 const output=pruneUnusedSchemaData(source);assert(!output.includes('schema1'));assert(output.includes('schema2'));assert(!output.includes('use strict'));
 assert.equal((await load(output)).value(),(await load(source)).value());
});
test('fails closed for potentially effectful unused schema initializers and dynamic eval',()=>{
 for(const source of [`const schema1=globalThis.effect();`,`const schema1={get value(){throw Error('getter')}};`,`const schema1={...globalThis.effect};`,`const schema1={value:globalThis.effect};`,`const schema1=1;eval('schema1');`])assert.throws(()=>pruneUnusedSchemaData(source),/SCHEMA_DATA_(SHAPE|EVAL)/);
});
test('preserves referenced schema data, non-schema declarations and getter evaluation',async()=>{
 const source=`const schema1={answer:42};const other={get value(){return 7;}};export function value(){return [schema1.answer,other.value];}`;
 const output=pruneUnusedSchemaData(source);assert.equal(output,source);assert.deepEqual((await load(output)).value(),(await load(source)).value());
});

test('keeps statement boundaries when unused data is surrounded by ASI-sensitive expressions',async()=>{
 const cases=[
  `const trace=[];trace.push(1)\nconst schema1=3;\n[2].forEach(x=>trace.push(x));export const result=trace;`,
  `const trace=[];trace.push(1)\nconst schema1=3;\n(()=>trace.push(2))();export const result=trace;`,
  "const trace=[];trace.push(1)\nconst schema1=3;\n`text`.toString();export const result=trace;",
  `const trace=[];trace.push(1)\nconst schema1=3;\n/a/.test('a');export const result=trace;`,
 ];
 for(const source of cases){const a=await load(source),b=await load(pruneUnusedSchemaData(source));assert.deepEqual(b.result,a.result);}
});
