// SPDX-License-Identifier: AGPL-3.0-or-later
/** Bounded compatibility check for an explicitly approved textured pair.
 * Format/PNG decoding remains the isolated validation worker's responsibility.
 * This checks retained geometry/texture relationships, not physical error or permission. */
import { measureFullVariant } from './viewer-variants.ts';
const fail=():never=>{throw Error('APPROVED_LOD_UNSUPPORTED');};
const closed=(v:unknown,required:string[],optional:string[]=[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const same=(a:unknown,b:unknown):boolean=>{const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;return JSON.stringify(sort(a))===JSON.stringify(sort(b));};
function model(bytes:Buffer){
 if(bytes.length<28||bytes.length>8*1024*1024||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)fail();
 const n=bytes.readUInt32LE(12),at=20+n;if(!n||n>1048576||n%4||at+8>bytes.length||bytes.readUInt32LE(at+4)!==0x004e4942||bytes.readUInt32LE(at)%4||at+8+bytes.readUInt32LE(at)!==bytes.length)fail();
 let d;try{d=JSON.parse(bytes.toString('utf8',20,at));}catch{fail();}const bin=bytes.subarray(at+8);
 if(!closed(d,['asset','scene','scenes','nodes','meshes','materials','images','textures','samplers','buffers','bufferViews','accessors'])||!closed(d.asset,['version'],['generator'])||d.asset.version!=='2.0'||d.scene!==0||!same(d.scenes,[{nodes:[0]}])||!same(d.nodes,[{mesh:0}])||!Array.isArray(d.buffers)||d.buffers.length!==1||!closed(d.buffers[0],['byteLength'])||!integer(d.buffers[0].byteLength)||d.buffers[0].byteLength<1||d.buffers[0].byteLength>bin.length||bin.length-d.buffers[0].byteLength>3)fail();
 if(!Array.isArray(d.meshes)||d.meshes.length!==1||!closed(d.meshes[0],['primitives'])||!Array.isArray(d.meshes[0].primitives)||!d.meshes[0].primitives.length||d.meshes[0].primitives.length>8||!Array.isArray(d.bufferViews)||d.bufferViews.length>64||!Array.isArray(d.accessors)||d.accessors.length>32||!Array.isArray(d.images)||!d.images.length||d.images.length>8||!Array.isArray(d.materials)||d.materials.length!==d.images.length||!Array.isArray(d.textures)||d.textures.length!==d.images.length||!same(d.samplers,[{magFilter:9729,minFilter:9729,wrapS:33071,wrapT:33071}]))fail();
 const view=(i:number)=>{const v=d.bufferViews[i];if(!integer(i)||!closed(v,['buffer','byteLength'],['byteOffset','target'])||v.buffer!==0||!integer(v.byteOffset??0)||!integer(v.byteLength)||!v.byteLength||(v.byteOffset??0)+v.byteLength>d.buffers[0].byteLength)fail();return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);};
 let pixels=0,imageBytes=0;
 const images=d.images.map((im:{bufferView:number;mimeType:string})=>{if(!closed(im,['bufferView','mimeType'])||im.mimeType!=='image/png')fail();const b=view(im.bufferView);if(b.length<33||b.toString('ascii',12,16)!=='IHDR')fail();const w=b.readUInt32BE(16),h=b.readUInt32BE(20);pixels+=w*h;imageBytes+=b.length;if(!w||!h||w>2048||h>2048||pixels>2097152||imageBytes>8388608)fail();return b;});
 for(let i=0;i<images.length;i++)if(!same(d.textures[i],{source:i,sampler:0})||!same(d.materials[i],{doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:i},metallicFactor:0,roughnessFactor:1}}))fail();
 const read=(i:number,components:number,index=false,bounds=false)=>{const a=d.accessors[i];if(!integer(i)||!closed(a,['bufferView','componentType','count','type'],bounds?['min','max']:[])||a.componentType!==(index?5125:5126)||a.type!==(index?'SCALAR':components===3?'VEC3':'VEC2')||!integer(a.count)||!a.count||a.count>131072)fail();const b=view(a.bufferView);if(b.length!==a.count*components*4)fail();return {a,b};};
 let vertices=0,triangles=0;
 const parts=d.meshes[0].primitives.map((p:{attributes:{POSITION:number;NORMAL:number;TEXCOORD_0:number};indices:number;material:number;mode:number},frame:number)=>{
  if(!closed(p,['attributes','indices','mode','material'])||!closed(p.attributes,['POSITION','NORMAL','TEXCOORD_0'])||p.mode!==4||p.material!==frame||frame>=images.length)fail();
  const pos=read(p.attributes.POSITION,3,false,true),normal=read(p.attributes.NORMAL,3),uv=read(p.attributes.TEXCOORD_0,2),ix=read(p.indices,1,true);vertices+=pos.a.count;triangles+=ix.a.count/3;if(vertices>65536||triangles>131072||ix.a.count%3||normal.a.count!==pos.a.count||uv.a.count!==pos.a.count)fail();
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],tuples=new Set<string>();
  for(let i=0;i<pos.a.count;i++){let norm=0;for(let c=0;c<3;c++){const x=pos.b.readFloatLE(i*12+c*4),y=normal.b.readFloatLE(i*12+c*4);if(!Number.isFinite(x)||Math.abs(x)>20000||!Number.isFinite(y))fail();min[c]=Math.min(min[c]!,x);max[c]=Math.max(max[c]!,x);norm+=y*y;}if(norm<1e-12||Math.abs(Math.sqrt(norm)-1)>1e-4)fail();for(let c=0;c<2;c++){const x=uv.b.readFloatLE(i*8+c*4);if(!Number.isFinite(x)||x<0||x>1)fail();}tuples.add(Buffer.concat([pos.b.subarray(i*12,i*12+12),normal.b.subarray(i*12,i*12+12),uv.b.subarray(i*8,i*8+8)]).toString('hex'));}
  if(!same(pos.a.min,min)||!same(pos.a.max,max))fail();for(let i=0;i<ix.a.count;i++)if(ix.b.readUInt32LE(i*4)>=pos.a.count)fail();
  const seen=new Set<string>();
  for(let i=0;i<ix.a.count;i+=3){const ids=[0,1,2].map(k=>ix.b.readUInt32LE((i+k)*4));if(new Set(ids).size!==3)fail();const key=[ids.join(','),[ids[1],ids[2],ids[0]].join(','),[ids[2],ids[0],ids[1]].join(',')].sort()[0]!;if(seen.has(key))fail();seen.add(key);const point=(j:number)=>[0,1,2].map(k=>pos.b.readFloatLE(ids[j]!*12+k*4)),a=point(0),b=point(1),c=point(2),ab=b.map((v,k)=>v-a[k]!),ac=c.map((v,k)=>v-a[k]!),n=[ab[1]!*ac[2]!-ab[2]!*ac[1]!,ab[2]!*ac[0]!-ab[0]!*ac[2]!,ab[0]!*ac[1]!-ab[1]!*ac[0]!];if(!n.every(Number.isFinite)||Math.hypot(...n)<1e-12)fail();let dot=0;for(const id of ids)for(let k=0;k<3;k++)dot+=n[k]!*normal.b.readFloatLE(id!*12+k*4);if(!Number.isFinite(dot)||dot<=0)fail();}

  return {min,max,tuples,triangles:ix.a.count/3};
 });
 if(parts.length!==images.length)fail();return {images,parts,triangles};
}
export function qualifyApprovedTexturedPair(full:Buffer,coarse:Buffer,declaredFull:number,declaredCoarse:number){
 const invalid=():never=>{throw Error('APPROVED_LOD_INVALID');};
 const f=model(full),c=model(coarse);if(full.length<=coarse.length||f.triangles!==declaredFull||c.triangles!==declaredCoarse||c.triangles>=f.triangles||f.parts.length!==c.parts.length)invalid();
 for(let i=0;i<f.parts.length;i++){const a=f.parts[i]!,b=c.parts[i]!;if(!f.images[i]!.equals(c.images[i]!)||!same(a.min,b.min)||!same(a.max,b.max)||b.triangles>=a.triangles)invalid();for(const key of b.tuples)if(!a.tuples.has(key))invalid();}
 return {full:measureFullVariant(full,'model/gltf-binary'),coarse:measureFullVariant(coarse,'model/gltf-binary')};
}
