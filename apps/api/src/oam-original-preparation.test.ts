// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {deflateSync} from 'node:zlib';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import {pngCrc} from './png-pixels.ts';
import {inspectCompactModelSource,modelPreparationHash} from './oam-original-preparation.ts';
import {prepareCompactModelInWorker} from './oam-original-preparation-process.ts';

function fixture(colour=192){
 const chunk=(name:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(name),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,colour,40,80]))),chunk('IEND',Buffer.alloc(0))]);
 const parts=[Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1,0,0,1]).buffer),Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from(new Uint32Array([0,1,2]).buffer),image];
 const views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[],blocks:Buffer[]=[];let length=0;
 for(const [i,part] of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});blocks.push(part);length+=part.length;const pad=(4-length%4)%4;blocks.push(Buffer.alloc(pad));length+=pad;}
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9729,wrapS:10497,wrapT:10497}],images:[{bufferView:4,mimeType:'image/png'}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'},{bufferView:3,componentType:5125,count:3,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:length}]};
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const out=Buffer.alloc(28+json.length+length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);Buffer.concat(blocks).copy(out,28+json.length);return out;
}
const identity=(bytes:Buffer)=>({bytes:bytes.length,sha256:modelPreparationHash(bytes)});
function gone(child:ChildProcess){if(child.pid)expect(()=>process.kill(child.pid!,0)).toThrow();}

it('binds each job digest without a source allowlist and rejects unsupported/integrity input before spawn',async()=>{
 const a=fixture(),b=fixture(120);expect(identity(a)).not.toEqual(identity(b));expect(inspectCompactModelSource(a,identity(a)).vertices).toBe(3);expect(inspectCompactModelSource(b,identity(b)).vertices).toBe(3);
 expect(()=>inspectCompactModelSource(a,identity(b))).toThrow('MODEL_PREPARATION_INPUT_INTEGRITY');
 let spawned=false;await expect(prepareCompactModelInWorker(a,identity(b),{onSpawn:()=>{spawned=true;}})).rejects.toMatchObject({code:'MODEL_PREPARATION_INPUT_INTEGRITY'});expect(spawned).toBe(false);
 const invalid=Buffer.from(a);invalid.write('BAD!',0);expect(()=>inspectCompactModelSource(invalid,identity(invalid))).toThrow('MODEL_PREPARATION_PROFILE_UNSUPPORTED');
});

it('preserves different compatible user originals unchanged and returns only after strict validation and close',async()=>{
 for(const source of [fixture(),fixture(120)]){const children:ChildProcess[]=[];const result=await prepareCompactModelInWorker(source,identity(source),{onSpawn:child=>children.push(child)});expect(result.bytes.equals(source)).toBe(true);expect(result.receipt.output.reusedOriginal).toBe(true);expect(result.workerDrained).toBe(true);expect(children).toHaveLength(2);children.forEach(gone);}
},20000);

it.each(['prepare','validate'] as const)('cancels during %s and waits for actual owned child close',async stage=>{
 const source=fixture(),controller=new AbortController(),children:ChildProcess[]=[];
 await expect(prepareCompactModelInWorker(source,identity(source),{signal:controller.signal,onSpawn:(child,current)=>{children.push(child);if(stage===current)controller.abort();}})).rejects.toMatchObject({code:'MODEL_PREPARATION_CANCELLED'});expect(children).toHaveLength(stage==='prepare'?1:2);children.forEach(gone);
},20000);

const original=process.env.EXHIBITOS_OAM_ORIGINAL,retained=process.env.EXHIBITOS_OAM_EVIDENCE;
it.skipIf(!original||!retained)('prepares actual acquired OAM with unchanged coordinates, role-aware textures and inherited writer drain',async()=>{
 const source=await readFile(original!),before=identity(source);expect(before).toEqual({bytes:8285292,sha256:'b79822fc08c007120de51cbaebf1caf71bd7387ac27c43b5bf9326c93540b0b3'});
 await mkdir(retained!,{recursive:true});const handles=[];while(!handles.length||handles.at(-1)!.fd<10)handles.push(await open(join(retained!,'writer.lock'),'a'));const children:ChildProcess[]=[];
 try{const result=await prepareCompactModelInWorker(source,before,{writerFd:handles.at(-1)!.fd,onSpawn:child=>children.push(child)});
  // Preserve successful product artifacts before evidence assertions.
  await writeFile(join(retained!,'compact.glb'),result.bytes);await writeFile(join(retained!,'receipt.json'),JSON.stringify({...result,bytes:undefined},null,2)+'\n');
  expect(result.receipt.output.triangles).toBeLessThanOrEqual(20000);expect(result.receipt.output.textureEdge).toBe(512);expect(result.receipt.output.reusedOriginal).toBe(false);expect(result.receipt.output.bounds).toEqual(result.receipt.source.bounds);expect(result.receipt.images.map(i=>i.role)).toEqual(['colour','occlusion','normal']);expect(result.receipt.images.map(i=>i.sourceChannels)).toEqual([3,1,3]);expect(identity(await readFile(original!))).toEqual(before);expect(children).toHaveLength(2);children.forEach(gone);
 }finally{await Promise.all(handles.map(h=>h.close()));}
},30000);
