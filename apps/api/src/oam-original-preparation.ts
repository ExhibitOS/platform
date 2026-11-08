// SPDX-License-Identifier: AGPL-3.0-or-later
// Reusable bounded profile. OAM is a representative test input, not an allowlist.
// Import custody, rights and approval remain the ordinary caller's obligations.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pngCrc} from './png-pixels.ts';

export const COMPACT_MODEL_LIMITS={sourceBytes:32*1024*1024,jsonBytes:1024*1024,vertices:131072,triangles:200000,imageEdge:4096,imagePixels:3*4096*4096,imageBytes:16*1024*1024,outputBytes:8*1024*1024} as const;
export const COMPACT_MODEL_RECIPE={version:1,id:'embedded-model-compact-20k-512-v1',limits:COMPACT_MODEL_LIMITS,meshoptimizer:'1.1.1',decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579',maxTriangles:20000,textureEdge:512,attributeWeights:[1,1,1,1,1],maxRelativeAppearanceError:0.05,lockAxisExtrema:true,resample:'partition-box-linear-srgb-colour-linear-ao-renormalized-normal-v1',coordinates:'unchanged-source',png:'rgb8-filter0-zlib9'} as const;
export const modelPreparationHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export const COMPACT_MODEL_RECIPE_SHA256=modelPreparationHash(Buffer.from(JSON.stringify(COMPACT_MODEL_RECIPE)));
const fail=(code='MODEL_PREPARATION_PROFILE_UNSUPPORTED'):never=>{throw Error(code);};
const closed=(v:unknown,required:string[],optional:string[]=[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
type Bounds={min:number[];max:number[]};
type Role='colour'|'occlusion'|'normal';
export interface ModelPreparationInput {bytes:number;sha256:string}
export interface CompactModelReceipt {
 version:1;recipeId:typeof COMPACT_MODEL_RECIPE.id;recipeSHA256:string;
 source:ModelPreparationInput&{triangles:number;vertices:number;bounds:Bounds};
 output:ModelPreparationInput&{triangles:number;vertices:number;textureEdge:number;bounds:Bounds;reusedOriginal:boolean};
 images:{role:Role;sourceSHA256:string;sourceBytes:number;sourceChannels:number;width:number;height:number;decodedSHA256:string;outputSHA256:string;outputWidth:number;outputHeight:number}[];
 simplifier:{version:'1.1.1';relativeAppearanceError:number;lockedVertices:number};decoder:typeof COMPACT_MODEL_RECIPE.decoder;
}
export interface CompactModelPreparation {bytes:Buffer;receipt:CompactModelReceipt}
export function matchesModelPreparationInput(bytes:Buffer,input:ModelPreparationInput){return !!input&&Number.isSafeInteger(input.bytes)&&input.bytes>=28&&input.bytes<=COMPACT_MODEL_LIMITS.sourceBytes&&/^[a-f0-9]{64}$/.test(input.sha256)&&Buffer.isBuffer(bytes)&&bytes.length===input.bytes&&modelPreparationHash(bytes)===input.sha256;}
function bounds(positions:Float32Array):Bounds{
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i++){const value=positions[i]!;if(!Number.isFinite(value)||Math.abs(value)>20000)fail();const axis=i%3;min[axis]=Math.min(min[axis]!,value);max[axis]=Math.max(max[axis]!,value);}
 return {min,max};
}
/** Narrow static, one-node/one-material indexed profile. No hash allowlist,
 * external resources, transformations, animations, extensions or unit guesses. */
export function inspectCompactModelSource(bytes:Buffer,input:ModelPreparationInput){
 if(!matchesModelPreparationInput(bytes,input))fail('MODEL_PREPARATION_INPUT_INTEGRITY');
 if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)fail();
 const jsonLength=bytes.readUInt32LE(12),binAt=20+jsonLength;
 if(jsonLength<4||jsonLength>COMPACT_MODEL_LIMITS.jsonBytes||jsonLength%4||binAt+8>bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a||bytes.readUInt32LE(binAt+4)!==0x004e4942||bytes.readUInt32LE(binAt)%4||binAt+8+bytes.readUInt32LE(binAt)!==bytes.length)fail();
 const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,binAt)));
 if(!closed(doc,['asset','scene','scenes','nodes','meshes','materials','textures','images','accessors','bufferViews','buffers'],['samplers'])||!closed(doc.asset,['version'],['generator','copyright'])||doc.asset.version!=='2.0'||doc.scene!==0||!isDeepStrictEqual(doc.scenes,[{nodes:[0]}])||!isDeepStrictEqual(doc.nodes,[{mesh:0}])||doc.buffers?.length!==1||!closed(doc.buffers[0],['byteLength'])||!integer(doc.buffers[0].byteLength)||doc.buffers[0].byteLength<1||doc.buffers[0].byteLength>bytes.length-binAt-8||bytes.length-binAt-8-doc.buffers[0].byteLength>3||!Array.isArray(doc.bufferViews)||doc.bufferViews.length>16||doc.accessors?.length!==4||doc.meshes?.length!==1||!closed(doc.meshes[0],['primitives'],['name'])||doc.meshes[0].primitives?.length!==1||doc.materials?.length!==1||!Array.isArray(doc.images)||doc.images.length<1||doc.images.length>3||!Array.isArray(doc.textures)||doc.textures.length!==doc.images.length)fail();
 const primitive=doc.meshes[0].primitives[0];
 if(!closed(primitive,['attributes','indices','material'],['mode'])||(primitive.mode??4)!==4||primitive.material!==0||!closed(primitive.attributes,['POSITION','NORMAL','TEXCOORD_0']))fail();
 const material=doc.materials[0],pbr=material?.pbrMetallicRoughness;
 if(!closed(material,['pbrMetallicRoughness'],['name','normalTexture','occlusionTexture','doubleSided','alphaMode'])||material.alphaMode!==undefined&&material.alphaMode!=='OPAQUE'||material.doubleSided!==undefined&&typeof material.doubleSided!=='boolean'||!closed(pbr,['baseColorTexture'],['baseColorFactor','metallicFactor','roughnessFactor']))fail();
 for(const n of [pbr.metallicFactor??1,pbr.roughnessFactor??1])if(!Number.isFinite(n)||n<0||n>1)fail();
 if(pbr.baseColorFactor!==undefined&&(!Array.isArray(pbr.baseColorFactor)||pbr.baseColorFactor.length!==4||pbr.baseColorFactor.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)))fail();
 const roles:{role:Role;image:number}[]=[],usedTextures=new Set<number>(),usedImages=new Set<number>();
 for(const [binding,role] of [[pbr.baseColorTexture,'colour'],[material.occlusionTexture,'occlusion'],[material.normalTexture,'normal']] as const){
  if(binding===undefined)continue;if(!closed(binding,['index'],['texCoord',...(role==='normal'?['scale']:role==='occlusion'?['strength']:[])])||!integer(binding.index)||binding.index>=doc.textures.length||(binding.texCoord??0)!==0||(binding.scale??1)!==1||(binding.strength??1)!==1||usedTextures.has(binding.index))fail();
  const texture=doc.textures[binding.index];if(!closed(texture,['source'],['sampler'])||!integer(texture.source)||texture.source>=doc.images.length||usedImages.has(texture.source))fail();
  if(texture.sampler!==undefined&&(!integer(texture.sampler)||!Array.isArray(doc.samplers)||texture.sampler>=doc.samplers.length))fail();usedTextures.add(binding.index);usedImages.add(texture.source);roles.push({role,image:texture.source});
 }
 if(usedImages.size!==doc.images.length||usedTextures.size!==doc.textures.length||doc.samplers!==undefined&&(!Array.isArray(doc.samplers)||doc.samplers.length>3))fail();
 for(const sampler of doc.samplers??[])if(!closed(sampler,[],['magFilter','minFilter','wrapS','wrapT','name'])||sampler.magFilter!==undefined&&![9728,9729].includes(sampler.magFilter)||sampler.minFilter!==undefined&&![9728,9729,9984,9985,9986,9987].includes(sampler.minFilter)||[sampler.wrapS,sampler.wrapT].some(n=>n!==undefined&&![33071,10497,33648].includes(n)))fail();
 const bin=bytes.subarray(binAt+8,binAt+8+doc.buffers[0].byteLength);
 const view=(index:unknown)=>{if(!integer(index)||index>=doc.bufferViews.length)fail();const v=doc.bufferViews[index as number],offset=v?.byteOffset??0;if(!closed(v,['buffer','byteLength'],['byteOffset','byteStride','target','name'])||v.buffer!==0||!integer(offset)||!integer(v.byteLength)||v.byteLength<1||offset+v.byteLength>bin.length)fail();return {data:bin.subarray(offset,offset+v.byteLength),view:v};};
 const vertices=doc.accessors[primitive.attributes.POSITION]?.count;if(!integer(vertices)||vertices<3||vertices>COMPACT_MODEL_LIMITS.vertices)fail('MODEL_PREPARATION_GEOMETRY_LIMIT');
 const floats=(index:unknown,size:number,type:string)=>{if(!integer(index)||index>=doc.accessors.length)fail();const a=doc.accessors[index as number];if(!closed(a,['bufferView','componentType','count','type'],['byteOffset','min','max','name'])||a.componentType!==5126||a.type!==type||a.count!==vertices)fail();const {data,view:v}=view(a.bufferView),offset=a.byteOffset??0,stride=v.byteStride??size*4;if(!integer(offset)||offset%4||!integer(stride)||stride<size*4||stride>252||stride%4||offset+(vertices-1)*stride+size*4>data.length)fail();const out=new Float32Array(vertices*size);for(let n=0;n<vertices;n++)for(let k=0;k<size;k++){const x=data.readFloatLE(offset+n*stride+k*4);if(!Number.isFinite(x)||Math.abs(x)>20000)fail();out[n*size+k]=x;}return out;};
 const positions=floats(primitive.attributes.POSITION,3,'VEC3'),normals=floats(primitive.attributes.NORMAL,3,'VEC3'),uv=floats(primitive.attributes.TEXCOORD_0,2,'VEC2'),sourceBounds=bounds(positions),position=doc.accessors[primitive.attributes.POSITION];
 if(!Array.isArray(position.min)||position.min.length!==3||!Array.isArray(position.max)||position.max.length!==3)fail();for(let a=0;a<3;a++)if(!Number.isFinite(position.min[a])||!Number.isFinite(position.max[a])||Math.abs(sourceBounds.min[a]!-position.min[a])>1e-5||Math.abs(sourceBounds.max[a]!-position.max[a])>1e-5)fail();
 for(let n=0;n<vertices;n++)if(Math.abs(Math.hypot(normals[n*3]!,normals[n*3+1]!,normals[n*3+2]!)-1)>1e-4)fail();
 if(!integer(primitive.indices)||primitive.indices>=doc.accessors.length||new Set([...Object.values(primitive.attributes),primitive.indices]).size!==4)fail();const a=doc.accessors[primitive.indices],component=a?.componentType===5125?4:a?.componentType===5123?2:0;
 if(!closed(a,['bufferView','componentType','count','type'],['byteOffset','name'])||!component||a.type!=='SCALAR'||!integer(a.count)||a.count<3||a.count%3||a.count/3>COMPACT_MODEL_LIMITS.triangles)fail('MODEL_PREPARATION_GEOMETRY_LIMIT');
 const {data:indexBytes,view:indexView}=view(a.bufferView),offset=a.byteOffset??0;if(indexView.byteStride!==undefined||!integer(offset)||offset%component||offset+a.count*component>indexBytes.length)fail();
 const indices=new Uint32Array(a.count);for(let n=0;n<indices.length;n++){const i=component===4?indexBytes.readUInt32LE(offset+n*4):indexBytes.readUInt16LE(offset+n*2);if(i>=vertices)fail();indices[n]=i;}
 let imageBytes=0;const images=doc.images.map((image:unknown)=>{if(!closed(image,['bufferView','mimeType'],['name']))fail();const i=image as {bufferView:number;mimeType:string};if(!['image/jpeg','image/png'].includes(i.mimeType))fail('MODEL_PREPARATION_CODEC_UNSUPPORTED');const result=view(i.bufferView);if(result.view.target!==undefined||result.view.byteStride!==undefined)fail();imageBytes+=result.data.length;if(imageBytes>COMPACT_MODEL_LIMITS.imageBytes)fail('MODEL_PREPARATION_IMAGE_LIMIT');return {bytes:result.data,mime:i.mimeType};}) as {bytes:Buffer;mime:string}[];
 return {doc,positions,normals,uv,indices,images,roles,bounds:sourceBounds,vertices};
}
function png(data:Buffer,width:number,height:number){
 const chunk=(name:string,value:Buffer)=>{const type=Buffer.from(name),body=Buffer.concat([type,value]),out=Buffer.alloc(12+value.length);out.writeUInt32BE(value.length);body.copy(out,4);out.writeUInt32BE(pngCrc(body),8+value.length);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(height*(1+width*3));for(let y=0;y<height;y++)data.copy(rows,y*(1+width*3)+1,y*width*3,(y+1)*width*3);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
const linear=Array.from({length:256},(_,v)=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
const colourByte=(v:number)=>Math.max(0,Math.min(255,Math.round(255*(v<=0.0031308?v*12.92:1.055*v**(1/2.4)-0.055))));
function downsample(decoded:Buffer,width:number,height:number,channels:1|3,role:Role){
 const ratio=Math.min(1,512/Math.max(width,height)),w=Math.max(1,Math.floor(width*ratio)),h=Math.max(1,Math.floor(height*ratio)),output=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let r=0,g=0,b=0,count=0;
  for(let sy=Math.floor(y*height/h);sy<Math.floor((y+1)*height/h);sy++)for(let sx=Math.floor(x*width/w);sx<Math.floor((x+1)*width/w);sx++){
   const at=(sy*width+sx)*channels;count++;
   if(role==='colour'){r+=linear[decoded[at]!]!;g+=linear[decoded[at+1]!]!;b+=linear[decoded[at+2]!]!;}
   else if(role==='normal'){r+=decoded[at]!/127.5-1;g+=decoded[at+1]!/127.5-1;b+=decoded[at+2]!/127.5-1;}
   else r+=decoded[at]!;
  }
  const at=(y*w+x)*3;
  if(role==='colour'){output[at]=colourByte(r/count);output[at+1]=colourByte(g/count);output[at+2]=colourByte(b/count);}
  else if(role==='normal'){const length=Math.hypot(r,g,b);if(length<1e-8){r=0;g=0;b=1;}else{r/=length;g/=length;b/=length;}output[at]=Math.round((r+1)*127.5);output[at+1]=Math.round((g+1)*127.5);output[at+2]=Math.round((b+1)*127.5);}
  else output[at]=output[at+1]=output[at+2]=Math.round(r/count);
 }
 return {bytes:png(output,w,h),width:w,height:h};
}
/** Worker-only entry: source hash is supplied by a persisted ordinary job. */
export async function prepareCompactModel(source:Buffer,identity:ModelPreparationInput):Promise<CompactModelPreparation>{
 const input=inspectCompactModelSource(source,identity),{validateBytes}=await import('gltf-validator'),{MeshoptSimplifier}=await import('meshoptimizer'),sharp=(await import('sharp')).default;
 const checked=await validateBytes(source,{externalResourceFunction:async()=>fail(),maxIssues:64});if(checked.issues.numErrors!==0)fail('MODEL_PREPARATION_GEOMETRY_REJECTED');
 if(sharp.versions.sharp!=='0.35.4'||sharp.versions.vips!=='8.18.6'||sharp.versions.mozjpeg!=='0826579')fail('MODEL_PREPARATION_CODEC_VERSION');
 const require=createRequire(import.meta.url),version=JSON.parse(await readFile(join(dirname(require.resolve('meshoptimizer')),'package.json'),'utf8')).version;if(version!=='1.1.1'||!MeshoptSimplifier.supported)fail('MODEL_PREPARATION_SIMPLIFIER_VERSION');
 sharp.cache(false);sharp.concurrency(1);
 const options={failOn:'warning' as const,limitInputPixels:COMPACT_MODEL_LIMITS.imageEdge**2,limitInputChannels:3,sequentialRead:true};let pixels=0;
 const plans=[];for(const {role,image} of input.roles){const encoded=input.images[image]!,metadata=await sharp(encoded.bytes,options).metadata(),channels=metadata.channels;
  if(metadata.format!==(encoded.mime==='image/jpeg'?'jpeg':'png')||!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096||metadata.depth!=='uchar'||metadata.isProgressive||(metadata.pages??1)!==1||(metadata.orientation??1)!==1||metadata.icc?.length||(role==='occlusion'?![1,3].includes(channels??0):channels!==3))fail('MODEL_PREPARATION_IMAGE_PROFILE');
  pixels+=metadata.width*metadata.height;if(pixels>COMPACT_MODEL_LIMITS.imagePixels)fail('MODEL_PREPARATION_IMAGE_LIMIT');plans.push({role,image,encoded:encoded.bytes,channels:channels as 1|3,width:metadata.width,height:metadata.height});
 }
 const compatible=input.indices.length/3<=20000&&input.images.every(i=>i.mime==='image/png')&&plans.every(p=>Math.max(p.width,p.height)<=512&&p.channels===3);
 const textures:Buffer[]=[],imageReceipts:CompactModelReceipt['images']=[];
 for(const plan of plans){const {role,image,encoded,channels,width,height}=plan;
  const decoded=await sharp(encoded,options).toColourspace(channels===1?'b-w':'srgb').raw().toBuffer({resolveWithObject:true});
  if(decoded.info.width!==width||decoded.info.height!==height||decoded.info.channels!==channels||decoded.data.length!==width*height*channels)fail('MODEL_PREPARATION_IMAGE_DECODE');
  const output=compatible?{bytes:encoded,width,height}:downsample(decoded.data,width,height,channels,role);textures[image]=output.bytes;
  imageReceipts.push({role,sourceSHA256:modelPreparationHash(encoded),sourceBytes:encoded.length,sourceChannels:channels,width,height,decodedSHA256:modelPreparationHash(decoded.data),outputSHA256:modelPreparationHash(output.bytes),outputWidth:output.width,outputHeight:output.height});
 }
 const sourceMetric={...identity,triangles:input.indices.length/3,vertices:input.vertices,bounds:input.bounds},edge=Math.max(...imageReceipts.map(p=>Math.max(p.outputWidth,p.outputHeight)));
 if(compatible)return {bytes:source,receipt:{version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,source:sourceMetric,output:{...sourceMetric,textureEdge:edge,reusedOriginal:true},images:imageReceipts,simplifier:{version:'1.1.1',relativeAppearanceError:0,lockedVertices:0},decoder:COMPACT_MODEL_RECIPE.decoder}};
 await MeshoptSimplifier.ready;
 const attributes=new Float32Array(input.vertices*5),locks=new Uint8Array(input.vertices);
 for(let n=0;n<input.vertices;n++){attributes.set(input.normals.subarray(n*3,n*3+3),n*5);attributes.set(input.uv.subarray(n*2,n*2+2),n*5+3);for(let a=0;a<3;a++)if(input.positions[n*3+a]===input.bounds.min[a]||input.positions[n*3+a]===input.bounds.max[a])locks[n]=1;}
 const [indices,error]=input.indices.length<=60000?[input.indices,0] as const:MeshoptSimplifier.simplifyWithAttributes(input.indices,input.positions,3,attributes,5,[...COMPACT_MODEL_RECIPE.attributeWeights],locks,60000,COMPACT_MODEL_RECIPE.maxRelativeAppearanceError);
 if(!Number.isFinite(error)||error<0||error>COMPACT_MODEL_RECIPE.maxRelativeAppearanceError||indices.length<3||indices.length%3||indices.length>60000)fail('MODEL_PREPARATION_COMPACT_BUDGET_UNMET');
 const [remap,vertices]=MeshoptSimplifier.compactMesh(indices),positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),uv=new Float32Array(vertices*2);
 for(let old=0;old<remap.length;old++){const n=remap[old]!;if(n===0xffffffff)continue;if(n>=vertices)fail('MODEL_PREPARATION_COMPACT_INVALID');positions.set(input.positions.subarray(old*3,old*3+3),n*3);normals.set(input.normals.subarray(old*3,old*3+3),n*3);uv.set(input.uv.subarray(old*2,old*2+2),n*2);}
 const outputBounds=bounds(positions);if(!isDeepStrictEqual(outputBounds,input.bounds))fail('MODEL_PREPARATION_BOUNDS_CHANGED');
 const parts=[Buffer.from(positions.buffer),Buffer.from(normals.buffer),Buffer.from(uv.buffer),Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength),...textures],chunks:Buffer[]=[],views:{buffer:number;byteOffset:number;byteLength:number;target?:number}[]=[];let length=0;
 for(const [i,part] of parts.entries()){views.push({buffer:0,byteOffset:length,byteLength:part.length,...(i<4?{target:i===3?34963:34962}:{})});chunks.push(part);length+=part.length;const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}}
 const doc={asset:{...input.doc.asset,generator:'ExhibitOS '+COMPACT_MODEL_RECIPE.id},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0,mode:4}]}],materials:input.doc.materials,textures:input.doc.textures,...(input.doc.samplers?{samplers:input.doc.samplers}:{}),images:textures.map((_,i)=>({bufferView:i+4,mimeType:'image/png'})),accessors:[{bufferView:0,componentType:5126,count:vertices,type:'VEC3',...outputBounds},{bufferView:1,componentType:5126,count:vertices,type:'VEC3'},{bufferView:2,componentType:5126,count:vertices,type:'VEC2'},{bufferView:3,componentType:5125,count:indices.length,type:'SCALAR'}],bufferViews:views,buffers:[{byteLength:length}]};
 const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);const bytes=Buffer.alloc(28+padded.length+length);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(padded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);padded.copy(bytes,20);bytes.writeUInt32LE(length,20+padded.length);bytes.writeUInt32LE(0x004e4942,24+padded.length);Buffer.concat(chunks,length).copy(bytes,28+padded.length);
 if(bytes.length>COMPACT_MODEL_LIMITS.outputBytes)fail('MODEL_PREPARATION_OUTPUT_LIMIT');
 return {bytes,receipt:{version:1,recipeId:COMPACT_MODEL_RECIPE.id,recipeSHA256:COMPACT_MODEL_RECIPE_SHA256,source:sourceMetric,output:{sha256:modelPreparationHash(bytes),bytes:bytes.length,triangles:indices.length/3,vertices,textureEdge:edge,bounds:outputBounds,reusedOriginal:false},images:imageReceipts,simplifier:{version:'1.1.1',relativeAppearanceError:error,lockedVertices:locks.reduce((a,b)=>a+b,0)},decoder:COMPACT_MODEL_RECIPE.decoder}};
}
