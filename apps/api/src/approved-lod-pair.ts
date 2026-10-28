import {decodePngPixels} from "./png-pixels.ts";
import {embeddedBasisPairs, ordinaryPngRoleSet, pbrTextureBinding, pbrTextureIsLinear} from '@exhibitos/studio-contract';
import type {PbrTextureRole} from '@exhibitos/studio-contract';
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Bounded compatibility check for an explicitly approved textured pair.
 * Format/PNG decoding remains the isolated validation worker's responsibility.
 * This checks retained geometry/texture relationships, not physical error or permission. */
import { measureFullVariant } from './viewer-variants.ts';
/** PNG decoding/CRC checks remain in the existing strict worker. This binds an
 * authored pair to measured detail and the same uncropped image rectangle. */
export function qualifyApprovedImagePair(full:Buffer,coarse:Buffer,fullEdge:number,coarseEdge:number){
 const dimensions=(bytes:Buffer,declared:number)=>{
  if(bytes.length<33||bytes.length>33554432||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes[24]!==8||![2,6].includes(bytes[25]!))throw Error('APPROVED_LOD_INVALID');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width*height>4194304||Math.max(width,height)>8192||!Number.isSafeInteger(declared)||declared<Math.max(width,height))throw Error('APPROVED_LOD_INVALID');
  return {width,height,edge:Math.max(width,height)};
 };
 const high=dimensions(full,fullEdge),low=dimensions(coarse,coarseEdge);
 if(low.edge>=high.edge||coarse.length>=full.length||Math.abs(high.width*low.height-high.height*low.width)>high.width+high.height)throw Error('APPROVED_LOD_UNSUPPORTED');
}
const fail=():never=>{throw Error('APPROVED_LOD_UNSUPPORTED');};
const closed=(v:unknown,required:string[],optional:string[]=[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const same=(a:unknown,b:unknown):boolean=>{const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;return JSON.stringify(sort(a))===JSON.stringify(sort(b));};
function model(bytes:Buffer,options:{exactTopologyTextureOnly?:true}={}){
 const textureDerivative=options.exactTopologyTextureOnly===true;
 if(bytes.length<28||bytes.length>(textureDerivative?32:8)*1024*1024||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)fail();
 const n=bytes.readUInt32LE(12),at=20+n;if(!n||n>1048576||n%4||at+8>bytes.length||bytes.readUInt32LE(at+4)!==0x004e4942||bytes.readUInt32LE(at)%4||at+8+bytes.readUInt32LE(at)!==bytes.length)fail();
 const d=(()=>{try{return JSON.parse(bytes.toString('utf8',20,at));}catch{return fail();}})(),bin=bytes.subarray(at+8);
 if(!closed(d,['asset','scene','scenes','nodes','meshes','materials','images','textures',...(textureDerivative?[]:['samplers']),'buffers','bufferViews','accessors'],['extensionsUsed','extensionsRequired',...(textureDerivative?['samplers']:[])])||!closed(d.asset,['version'],['generator'])||d.asset.version!=='2.0'||d.scene!==0||!same(d.scenes,[{nodes:[0]}])||!same(d.nodes,[{mesh:0}])||!Array.isArray(d.buffers)||d.buffers.length!==1||!closed(d.buffers[0],['byteLength'])||!integer(d.buffers[0].byteLength)||d.buffers[0].byteLength<1||d.buffers[0].byteLength>bin.length||bin.length-d.buffers[0].byteLength>3)fail();
 if(!Array.isArray(d.meshes)||d.meshes.length!==1||!closed(d.meshes[0],['primitives'])||!Array.isArray(d.meshes[0].primitives)||!d.meshes[0].primitives.length||d.meshes[0].primitives.length>8||!Array.isArray(d.bufferViews)||d.bufferViews.length>64||!Array.isArray(d.accessors)||d.accessors.length>32||!Array.isArray(d.images)||!d.images.length||d.images.length>16||!Array.isArray(d.materials)||d.materials.length<1||d.materials.length>8||!Array.isArray(d.textures)||d.textures.length<1||d.textures.length>8||(!textureDerivative||d.samplers!==undefined)&&(!Array.isArray(d.samplers)||d.samplers.length<1||d.samplers.length>8))fail();
 const view=(i:number)=>{const v=d.bufferViews[i];if(!integer(i)||!closed(v,['buffer','byteLength'],['byteOffset','target'])||v.buffer!==0||!integer(v.byteOffset??0)||!integer(v.byteLength)||!v.byteLength||(v.byteOffset??0)+v.byteLength>d.buffers[0].byteLength)fail();return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);};
 const basis=embeddedBasisPairs(d,(i)=>view(d.images[i].bufferView));
 if(textureDerivative&&!ordinaryPngRoleSet(d))fail();
 let pixels=0,imageBytes=0;
 const images=d.images.map((im:{bufferView:number;mimeType:string})=>{if(!closed(im,['bufferView','mimeType'])||!['image/png','image/ktx2'].includes(im.mimeType))fail();const b=view(im.bufferView);if(im.mimeType==='image/ktx2')return b;if(b.length<33||b.toString('ascii',12,16)!=='IHDR')fail();const w=b.readUInt32BE(16),h=b.readUInt32BE(20);pixels+=w*h;imageBytes+=b.length;if(!w||!h||w>2048||h>2048||pixels>(textureDerivative?12582912:2097152)||imageBytes>(textureDerivative?25165824:8388608))fail();return b;});
 // Bind each primitive through its actual PBR material; one material may use colour, normal, AO and packed G-roughness/B-metalness maps.
 const usedTextures=new Set<number>(),usedSamplers=new Set<number>(),usedImages=new Set<number>(),colourImages=new Set<number>(),linearImages=new Set<number>();
 const samplers=(d.samplers??[{}]).map((input:Record<string,unknown>)=>{if(textureDerivative&&!closed(input,[],['magFilter','minFilter','wrapS','wrapT']))fail();const v=textureDerivative?{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497,...input}:input;if(!textureDerivative&&!closed(v,['magFilter','minFilter','wrapS','wrapT'])||![9728,9729].includes(v.magFilter as number)||!(textureDerivative?[9728,9729,9984,9985,9986,9987]:[9729]).includes(v.minFilter as number)||![33071,10497,33648].includes(v.wrapS as number)||![33071,10497,33648].includes(v.wrapT as number))fail();return v;});
 const textures=d.textures.map((v:{source:number;sampler:number})=>{if(!closed(v,textureDerivative?['source']:['source','sampler'],['extensions',...(textureDerivative?['sampler']:[])])||!integer(v.source)||v.source>=images.length||!integer(v.sampler??(textureDerivative?0:undefined))||(v.sampler??0)>=samplers.length)fail();const sampler=v.sampler??0;usedSamplers.add(sampler);usedImages.add(v.source);return {...v,sampler};});
 for(const index of basis.keys())usedImages.add(index);
 if(usedSamplers.size!==samplers.length||usedImages.size!==images.length)fail();
 const map=(input:unknown,role:PbrTextureRole)=>{
  if(input===undefined)return null;
  const binding=(()=>{try{return pbrTextureBinding(input,role,textures.length);}catch{return fail();}})();
  const {index,texCoord,scale,strength}=binding,texture=textures[index],source=texture.source,linear=pbrTextureIsLinear(role);
  usedTextures.add(index);
  if(linear&&(d.images[source].mimeType!=='image/png'||Object.hasOwn(texture,'extensions')))fail();
  (linear?linearImages:colourImages).add(source);
  return {index,texCoord,...(scale===undefined?{}:{scale}),...(strength===undefined?{}:{strength})};
 };
 const materials=d.materials.map((m:Record<string,unknown>)=>{
  if(!closed(m,['pbrMetallicRoughness'],['doubleSided','normalTexture','occlusionTexture',...(textureDerivative?['name']:[])])||Object.hasOwn(m,'doubleSided')&&typeof m.doubleSided!=='boolean')fail();
  const p=m.pbrMetallicRoughness as Record<string,unknown>;if(!closed(p,['baseColorTexture'],['baseColorFactor','metallicFactor','roughnessFactor','metallicRoughnessTexture']))fail();
  const factor=p.baseColorFactor??[1,1,1,1];if(!Array.isArray(factor)||factor.length!==4||factor.some((v:unknown)=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))fail();
  for(const name of ['metallicFactor','roughnessFactor'])if(Object.hasOwn(p,name)&&(typeof p[name]!=='number'||!Number.isFinite(p[name])||p[name]<0||p[name]>1))fail();
  return {doubleSided:m.doubleSided??false,baseColorTexture:map(p.baseColorTexture,'colour'),metallicRoughnessTexture:map(p.metallicRoughnessTexture,'metallicRoughness'),baseColorFactor:factor,metallicFactor:p.metallicFactor??1,roughnessFactor:p.roughnessFactor??1,normalTexture:map(m.normalTexture,'normal'),occlusionTexture:map(m.occlusionTexture,'occlusion')};
 });
 if(usedTextures.size!==textures.length||[...linearImages].some(i=>colourImages.has(i)))fail();
 const read=(i:number,components:number,index=false,bounds=false)=>{const a=d.accessors[i];if(!integer(i)||!closed(a,['bufferView','componentType','count','type'],bounds?['min','max']:[])||a.componentType!==(index?5125:5126)||a.type!==(index?'SCALAR':components===4?'VEC4':components===3?'VEC3':'VEC2')||!integer(a.count)||!a.count||a.count>(index?(textureDerivative?750000:3*131072):131072))fail();const b=view(a.bufferView);if(b.length!==a.count*components*4)fail();return {a,b};};
 let vertices=0,triangles=0;const usedMaterials=new Set<number>();
 const parts=d.meshes[0].primitives.map((p:{attributes:{POSITION:number;NORMAL:number;TEXCOORD_0:number;TANGENT?:number};indices:number;material:number;mode:number})=>{
  if(!closed(p,['attributes','indices','mode','material'])||!closed(p.attributes,['POSITION','NORMAL','TEXCOORD_0'],['TANGENT'])||p.mode!==4||!integer(p.material)||p.material>=materials.length)fail();
  usedMaterials.add(p.material);
  const tangent=p.attributes.TANGENT===undefined?null:read(p.attributes.TANGENT,4);
  const pos=read(p.attributes.POSITION,3,false,true),normal=read(p.attributes.NORMAL,3),uv=read(p.attributes.TEXCOORD_0,2),ix=read(p.indices,1,true);vertices+=pos.a.count;triangles+=ix.a.count/3;if(vertices>(textureDerivative?131072:65536)||triangles>(textureDerivative?250000:131072)||ix.a.count%3||normal.a.count!==pos.a.count||uv.a.count!==pos.a.count||tangent!==null&&tangent.a.count!==pos.a.count)fail();
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],tuples=new Set<string>();
  for(let i=0;i<pos.a.count;i++){let norm=0;for(let c=0;c<3;c++){const x=pos.b.readFloatLE(i*12+c*4),y=normal.b.readFloatLE(i*12+c*4);if(!Number.isFinite(x)||Math.abs(x)>20000||!Number.isFinite(y))fail();min[c]=Math.min(min[c]!,x);max[c]=Math.max(max[c]!,x);norm+=y*y;}if(norm<1e-12||Math.abs(Math.sqrt(norm)-1)>1e-4)fail();for(let c=0;c<2;c++){const x=uv.b.readFloatLE(i*8+c*4);if(!Number.isFinite(x)||Math.abs(x)>20000)fail();}if(tangent){for(let k=0;k<4;k++){const v=tangent.b.readFloatLE(i*16+k*4);if(!Number.isFinite(v)||k===3&&v!==1&&v!==-1)fail();}const length=Math.hypot(...[0,1,2].map(k=>tangent.b.readFloatLE(i*16+k*4)));const dot=[0,1,2].reduce((sum,k)=>sum+tangent.b.readFloatLE(i*16+k*4)*normal.b.readFloatLE(i*12+k*4),0);if(Math.abs(length-1)>1e-4||Math.abs(dot)>1e-4)fail();}tuples.add(Buffer.concat([pos.b.subarray(i*12,i*12+12),normal.b.subarray(i*12,i*12+12),uv.b.subarray(i*8,i*8+8),...(tangent?[tangent.b.subarray(i*16,i*16+16)]:[])]).toString('hex'));}
  if(textureDerivative?(!Array.isArray(pos.a.min)||!Array.isArray(pos.a.max)||pos.a.min.length!==3||pos.a.max.length!==3||[0,1,2].some(k=>!Number.isFinite(pos.a.min[k])||!Number.isFinite(pos.a.max[k])||Math.abs(pos.a.min[k]-min[k]!)>1e-5||Math.abs(pos.a.max[k]-max[k]!)>1e-5)):!same(pos.a.min,min)||!same(pos.a.max,max))fail();for(let i=0;i<ix.a.count;i++)if(ix.b.readUInt32LE(i*4)>=pos.a.count)fail();
  const seen=new Set<string>();
  for(let i=0;i<ix.a.count;i+=3){const ids=[0,1,2].map(k=>ix.b.readUInt32LE((i+k)*4));if(new Set(ids).size!==3)fail();const key=[ids.join(','),[ids[1],ids[2],ids[0]].join(','),[ids[2],ids[0],ids[1]].join(',')].sort()[0]!;if(seen.has(key))fail();seen.add(key);const point=(j:number)=>[0,1,2].map(k=>pos.b.readFloatLE(ids[j]!*12+k*4)),a=point(0),b=point(1),c=point(2),ab=b.map((v,k)=>v-a[k]!),ac=c.map((v,k)=>v-a[k]!),n=[ab[1]!*ac[2]!-ab[2]!*ac[1]!,ab[2]!*ac[0]!-ab[0]!*ac[2]!,ab[0]!*ac[1]!-ab[1]!*ac[0]!];if(!n.every(Number.isFinite)||Math.hypot(...n)<1e-12)fail();let dot=0;for(const id of ids)for(let k=0;k<3;k++)dot+=n[k]!*normal.b.readFloatLE(id!*12+k*4);// Texture-only copies cannot introduce a new face or alter an authored normal.
  if(!Number.isFinite(dot)||!textureDerivative&&dot<=0)fail();}

  return {min,max,tuples,streams:[pos.b,normal.b,uv.b,ix.b,...(tangent?[tangent.b]:[])],triangles:ix.a.count/3,material:p.material,tangentPresent:tangent!==null};
 });
 if(usedMaterials.size!==materials.length)fail();return {document:d,images,documentIdentity:Object.fromEntries(Object.entries(d).filter(([key])=>!["buffers","bufferViews","images"].includes(key))),colourImages,linearImages,parts,triangles,bindings:{materials,textures,samplers}};
}
export function qualifyApprovedTexturedPair(full:Buffer,coarse:Buffer,declaredFull:number,declaredCoarse:number){
 const invalid=():never=>{throw Error('APPROVED_LOD_INVALID');};
 const f=model(full),c=model(coarse);if(full.length<=coarse.length||f.triangles!==declaredFull||c.triangles!==declaredCoarse||c.triangles>=f.triangles||f.parts.length!==c.parts.length||f.images.length!==c.images.length||!same(f.bindings,c.bindings))invalid();
 for(let i=0;i<f.parts.length;i++){const a=f.parts[i]!,b=c.parts[i]!;if(!f.images.every((b:Buffer,j:number)=>b.equals(c.images[j]??Buffer.alloc(0)))||!same(a.min,b.min)||!same(a.max,b.max)||a.material!==b.material||a.tangentPresent!==b.tangentPresent||b.triangles>=a.triangles)invalid();for(const key of b.tuples)if(!a.tuples.has(key))invalid();}
 return {full:measureFullVariant(full,'model/gltf-binary'),coarse:measureFullVariant(coarse,'model/gltf-binary')};
}

/** Explicit three-role texture derivative, separate from legacy geometry LOD.
 * Both GLBs must also pass the existing isolated strict decoder/current rights.
 * This proves exact geometry and channel sampling, never visual equivalence,
 * source authorship, physical units, or a device residency guarantee. */
export function qualifyApprovedTextureDerivativePair(full:Buffer,reduced:Buffer,declared:{triangles:number;fullTextureSize:number;reducedTextureSize:number}){
 const f=model(full,{exactTopologyTextureOnly:true}),c=model(reduced,{exactTopologyTextureOnly:true});
 if(full.length<=reduced.length||f.triangles!==declared.triangles||c.triangles!==f.triangles||f.parts.length!==1||c.parts.length!==1||!same(f.bindings,c.bindings)||!same(f.documentIdentity,c.documentIdentity)||f.images.length!==3||c.images.length!==3)fail();
 const a=f.parts[0]!,b=c.parts[0]!;
 if(!same(a.min,b.min)||!same(a.max,b.max)||a.material!==b.material||a.streams.length!==b.streams.length||!a.streams.every((bytes:Buffer,i:number)=>bytes.equals(b.streams[i]!)))fail();
 let fullEdge=0,reducedEdge=0,changed=false;
 for(let i=0;i<f.images.length;i++){
  // The unchanged binding establishes each actual image's semantic role.
  const colour=f.colourImages.has(i),high=decodePngPixels(f.images[i]!,4194304,2048,1024),low=decodePngPixels(c.images[i]!,4194304,2048,1024);
  if(Math.max(high.width,high.height)<1024||high.channels!==3||low.channels!==3||high.srgbIntent!==low.srgbIntent||f.colourImages.has(i)!==c.colourImages.has(i)||f.linearImages.has(i)!==c.linearImages.has(i))fail();
  const ratio=Math.min(1,(colour?512:256)/Math.max(high.width,high.height));
  if(low.width!==Math.max(1,Math.floor(high.width*ratio))||low.height!==Math.max(1,Math.floor(high.height*ratio)))fail();
  for(let y=0;y<low.height;y++)for(let x=0;x<low.width;x++){
   const sy=Math.min(high.height-1,Math.floor((2*y+1)*high.height/(2*low.height))),sx=Math.min(high.width-1,Math.floor((2*x+1)*high.width/(2*low.width)));
   for(let channel=0;channel<3;channel++)if(low.pixels[y*(low.width*3+1)+1+x*3+channel]!==high.pixels[sy*(high.width*3+1)+1+sx*3+channel])fail();
  }
  changed ||= ratio<1;
  fullEdge=Math.max(fullEdge,high.width,high.height);reducedEdge=Math.max(reducedEdge,low.width,low.height);
 }
 if(!changed||fullEdge!==declared.fullTextureSize||reducedEdge!==declared.reducedTextureSize||fullEdge<1024)fail();
 return {full:measureFullVariant(full,'model/gltf-binary'),coarse:measureFullVariant(reduced,'model/gltf-binary')};
}

/** Existing strict ordinary subset; replace only embedded image payloads. */
export function prepareTextureDerivative(full:Buffer,resample:(png:Buffer,edge:512|256)=>Buffer){
 const observed=model(full,{exactTopologyTextureOnly:true}),doc=structuredClone(observed.document),n=full.readUInt32LE(12),bin=full.subarray(28+n);
 if(observed.parts.length!==1||!ordinaryPngRoleSet(doc))fail();
 const replacements=new Map<number,Buffer>();
 for(let i=0;i<doc.images.length;i++)replacements.set(doc.images[i].bufferView,resample(observed.images[i]!,observed.colourImages.has(i)?512:256));
 const pieces:Buffer[]=[];let offset=0;
 for(const [index,view] of doc.bufferViews.entries()){
  const data=replacements.get(index)??bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
  view.byteOffset=offset;view.byteLength=data.length;pieces.push(data,Buffer.alloc((4-data.length%4)%4));offset+=Math.ceil(data.length/4)*4;
 }
 doc.buffers[0].byteLength=offset;
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),body=Buffer.concat(pieces),header=Buffer.alloc(20),bh=Buffer.alloc(8);
 if(json.length>1048576||body.length+json.length+28>33554432)fail();
 header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+body.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(body.length);bh.writeUInt32LE(0x004e4942,4);
 const reduced=Buffer.concat([header,json,bh,body]),high=measureFullVariant(full,'model/gltf-binary'),low=measureFullVariant(reduced,'model/gltf-binary');
 const metrics=qualifyApprovedTextureDerivativePair(full,reduced,{triangles:high.triangles!,fullTextureSize:high.textureSize!,reducedTextureSize:low.textureSize!});
 return {bytes:reduced,metrics};
}
