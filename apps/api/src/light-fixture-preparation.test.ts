// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {validateBytes} from 'gltf-validator';
import {prepareLightFixtureSource,LIGHT_FIXTURE_PREPARATION_POLICY} from './light-fixture-preparation.ts';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function pack(doc:unknown,bin:Buffer,transform=(text:string)=>text){
 const raw=Buffer.from(transform(JSON.stringify(doc))),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const b=Buffer.alloc(28+json.length+bin.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);b.writeUInt32LE(bin.length,20+json.length);b.writeUInt32LE(0x004e4942,24+json.length);bin.copy(b,28+json.length);return b;
}
function fixture(strided=false){
 const stride=strided?24:16,bin=Buffer.alloc(48+stride*3+4,0x5b);
 const vectors=[[0,0,0,1],[1,0,0,1],[0,1,0,-1]];
 const positions=[1,0,0,0,1,0,0,0,1];for(let i=0;i<positions.length;i++)bin.writeFloatLE(positions[i]!,i*4);
 for(let i=0;i<3;i++)bin.writeUInt16LE(i,36+i*2);
 for(let i=0;i<3;i++)for(let c=0;c<4;c++)bin.writeFloatLE(vectors[i]![c]!,48+i*stride+c*4);
 const doc={asset:{version:'2.0',generator:'Synthetic source'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{mesh:0,name:'Original node',translation:[1,2,3]},{mesh:1}],
  meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TANGENT:2},material:0,indices:3}]},{primitives:[{attributes:{POSITION:0,NORMAL:1,TANGENT:2},material:0}]}],
  materials:[{name:'Constant material',pbrMetallicRoughness:{baseColorFactor:[.5,.6,.7,1],roughnessFactor:.4}}],
  buffers:[{byteLength:bin.length-2}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,byteStride:12,target:34962},{buffer:0,byteOffset:48,byteLength:stride*3,...(strided?{byteStride:stride}:{})},{buffer:0,byteOffset:36,byteLength:6,target:34963}],
  accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,1]},{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5126,type:'VEC4',count:3},{bufferView:2,componentType:5123,type:'SCALAR',count:3}],extras:{retained:'source metadata'}};
 return {doc,bin,bytes:pack(doc,bin)};
}
const unpack=(b:Buffer)=>{const end=20+b.readUInt32LE(12);return {doc:JSON.parse(b.toString('utf8',20,end)),bin:b.subarray(end+8),chunk:b.subarray(end)};};
const reject=(b:Buffer)=>expect(()=>prepareLightFixtureSource(b)).toThrow('LIGHT_FIXTURE_PREPARATION_UNSAFE');

describe('feature-based light fixture unused invalid tangent preparation',()=>{
 it.each([false,true])('removes only actual invalid unused bindings across meshes, strided=%s',strided=>{
  const f=fixture(strided),before=Buffer.from(f.bytes),r=prepareLightFixtureSource(f.bytes),out=unpack(r.bytes),expected=structuredClone(f.doc);
  for(const m of expected.meshes)delete (m.primitives[0]!.attributes as {TANGENT?:number}).TANGENT;
  expect(out.doc).toEqual(expected);expect(out.chunk).toEqual(unpack(f.bytes).chunk);expect(f.bytes).toEqual(before);
  expect(r.receipt).toEqual({version:1,policy:LIGHT_FIXTURE_PREPARATION_POLICY,source:{sha256:hash(before),bytes:before.length},derived:{sha256:hash(r.bytes),bytes:r.bytes.length},removed:[{mesh:0,primitive:0,accessor:2},{mesh:1,primitive:0,accessor:2}],binSHA256:hash(f.bin)});
  expect(out.doc.accessors).toEqual(f.doc.accessors);expect(out.doc.nodes).toEqual(f.doc.nodes);expect(out.doc.materials).toEqual(f.doc.materials);reject(r.bytes);
 });
 it('fixes the synthetic tangent errors under the existing validator without executing a worker',async()=>{
  const f=fixture(),result=prepareLightFixtureSource(f.bytes),options={maxIssues:64,externalResourceFunction:()=>Promise.reject(Error('external forbidden'))};
  expect((await validateBytes(f.bytes,options)).issues.numErrors).toBeGreaterThan(0);
  expect((await validateBytes(result.bytes,options)).issues.numErrors).toBe(0);
 });
 it('retains a valid unused tangent binding on another accessor',()=>{
  const f=fixture(),bin=Buffer.concat([f.bin,Buffer.alloc(48)]);for(let i=0;i<3;i++){bin.writeFloatLE(1,f.bin.length+i*16);bin.writeFloatLE(1,f.bin.length+i*16+12);}
  f.doc.bufferViews.push({buffer:0,byteOffset:f.bin.length,byteLength:48,target:34962});f.doc.accessors.push({bufferView:3,componentType:5126,type:'VEC4',count:3});f.doc.meshes[1]!.primitives[0]!.attributes.TANGENT=4;f.doc.buffers[0]!.byteLength=bin.length;
  const r=prepareLightFixtureSource(pack(f.doc,bin));expect(r.receipt.removed).toEqual([{mesh:0,primitive:0,accessor:2}]);expect(unpack(r.bytes).doc.meshes[1].primitives[0].attributes.TANGENT).toBe(4);
 });
 it('rejects a valid unused binding, including harmless unit quantization',()=>{
  const f=fixture();for(const length of [1,1.005]){for(let i=0;i<3;i++){f.bin.writeFloatLE(length,48+i*16);f.bin.writeFloatLE(0,52+i*16);f.bin.writeFloatLE(0,56+i*16);}reject(pack(f.doc,f.bin));}
 });
 it('recognizes invalid finite handedness without fabricating or replacing vectors',()=>{
  const f=fixture();f.bin.writeFloatLE(1,48);f.bin.writeFloatLE(0,60);const before=Buffer.from(f.bin),r=prepareLightFixtureSource(pack(f.doc,f.bin));expect(unpack(r.bytes).bin).toEqual(before);expect(r.receipt.removed).toHaveLength(2);
 });
 it.each([
  ['normal mapped',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.materials[0]!,{normalTexture:{index:0}})],
  ['material extension',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.materials[0]!,{extensions:{KHR_materials_clearcoat:{}}})],
  ['primitive extension',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.meshes[0]!.primitives[0]!,{extensions:{}})],
  ['morph target',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.meshes[0]!.primitives[0]!,{targets:[]})],
  ['sparse',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.accessors[2]!,{sparse:{count:1}})],
  ['integer tangent',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[2]!.componentType=5123;}],
  ['wrong vector',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[2]!.type='VEC3';}],
  ['normalized float',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.accessors[2]!,{normalized:true})],
  ['zero count',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[2]!.count=0;}],
  ['mismatched count',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[2]!.count=2;}],
  ['huge count',(d:ReturnType<typeof fixture>['doc'])=>{d.accessors[2]!.count=Number.MAX_SAFE_INTEGER;}],
  ['bad buffer',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1]!.buffer=1;}],
  ['view outside BIN',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1]!.byteOffset=100000;}],
  ['unaligned view',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1]!.byteOffset=47;}],
  ['truncated accessor',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1]!.byteLength=47;}],
  ['unaligned accessor',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.accessors[2]!,{byteOffset:1})],
  ['oversized accessor offset',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.accessors[2]!,{byteOffset:Number.MAX_SAFE_INTEGER})],
  ['short stride',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.bufferViews[1]!,{byteStride:12})],
  ['unaligned stride',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.bufferViews[1]!,{byteStride:17})],
  ['oversized stride',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.bufferViews[1]!,{byteStride:256})],
  ['wrong target',(d:ReturnType<typeof fixture>['doc'])=>{d.bufferViews[1]!.target=34963;}],
  ['external URI',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d.buffers[0]!,{uri:'external.bin'})],
  ['animation',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d,{animations:[]})],
  ['skin',(d:ReturnType<typeof fixture>['doc'])=>Object.assign(d,{skins:[]})],
  ['missing material',(d:ReturnType<typeof fixture>['doc'])=>{d.meshes[0]!.primitives[0]!.material=9;}],
 ] as const)('rejects unsupported %s',(_name,change)=>{const f=fixture();change(f.doc);reject(pack(f.doc,f.bin));});
 it.each([NaN,Infinity,-Infinity])('rejects nonfinite tangent data %s',number=>{const f=fixture();f.bin.writeFloatLE(number,48);reject(pack(f.doc,f.bin));});
 it.each([
  (s:string)=>s.replace('"scene":0','"scene":0,"scene":1'),
  (s:string)=>s.replace('"scene":0','"scene":0,"\\u0073cene":1'),
  (s:string)=>s.replace('"scene":0','"scene":1e999'),
  (s:string)=>s.replace('"scene":0','"scene":-0'),
 ])('rejects ambiguous/nonfinite JSON before serialization',change=>{const f=fixture();reject(pack(f.doc,f.bin,change));});
 it('rejects malformed chunk ranges, extra chunks, invalid UTF8 and bounded-size overflow',()=>{
  const f=fixture();for(const [at,value]of [[4,1],[8,f.bytes.length-4],[12,1048580],[16,0],[20+f.bytes.readUInt32LE(12),f.bin.length-4]]){const b=Buffer.from(f.bytes);b.writeUInt32LE(value!,at!);reject(b);}
  const extra=Buffer.concat([f.bytes,Buffer.alloc(12)]);extra.writeUInt32LE(extra.length,8);reject(extra);
  const utf=Buffer.from(f.bytes);utf[21]=255;reject(utf);reject(Buffer.alloc(8388609));reject(f.bytes.subarray(0,27));
 });
 it('supports an aligned tangent accessor offset within its buffer view',()=>{
  const f=fixture(),bin=Buffer.concat([f.bin.subarray(0,48),Buffer.alloc(4,9),f.bin.subarray(48)]);f.doc.bufferViews[1]!.byteLength+=4;Object.assign(f.doc.accessors[2]!,{byteOffset:4});f.doc.buffers[0]!.byteLength+=4;
  const r=prepareLightFixtureSource(pack(f.doc,bin));expect(unpack(r.bytes).bin).toEqual(bin);
 });
});
