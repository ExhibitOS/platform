// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {isSurfaceTextureBinding,surfaceTextureDefaults} from '../packages/studio-contract/dist/index.js';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const Ajv2020=require('ajv/dist/2020.js').default;
const schema=JSON.parse(await readFile(new URL('../contracts/studio-materials.schema.json',import.meta.url),'utf8'));
const valid=new Ajv2020({strict:true}).compile(schema),id='10000000-0000-4000-8000-000000000001';
test('published material schema accepts legacy metadata and the closed runtime texture binding',()=>{
 assert(valid({version:1,surfaces:{}}));
 const material={color:'#abcdef',roughness:.5,metalness:.1};
 assert(valid({version:1,surfaces:{[id]:material}}));
 for(const pack of ['museum-matte-paint','fine-lime-plaster']){
  const binding=surfaceTextureDefaults(pack).texture;
  const cases=[binding,{...binding,repeatMeters:[.05,20],rotation:-Math.PI,normalScale:0},{...binding,rotation:Math.PI,normalScale:2},{...binding,pack:{id:pack,version:2}},{...binding,pack:{id:'unknown',version:1}},{...binding,repeatMeters:[.049,1]},{...binding,repeatMeters:[1,20.001]},{...binding,repeatMeters:[1,1,1]},{...binding,rotation:Math.PI+.001},{...binding,normalScale:2.001},{...binding,url:'https://invalid.example/map.png'}];
  for(const value of cases)assert.equal(valid({version:1,surfaces:{[id]:material},surfaceTextures:{[id]:value}}),isSurfaceTextureBinding(value),JSON.stringify(value));
 }
 assert(!valid({version:1,surfaces:{},surfaceTextures:{'not-a-uuid':surfaceTextureDefaults('museum-matte-paint').texture}}));
 assert(!valid({version:1,surfaces:{},unknown:{}}));
});
