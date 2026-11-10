// SPDX-License-Identifier: AGPL-3.0-or-later
import {crc32} from 'node:zlib';

export const MAX_INFO_STAND_SOURCE_BYTES=4*1024*1024;
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const fail=():never=>{throw Error('INFO_STAND_PREPARATION_UNSAFE');};

type BufferView={buffer:number;byteLength:number;byteOffset?:number;target?:number;byteStride?:number};
type TextureRef={index:number};
type SourceDocument={
 extensionsUsed?:unknown[];extensionsRequired?:unknown[];
 buffers?:{byteLength:number;uri?:string}[];
 bufferViews?:BufferView[];
 accessors?:{bufferView?:number;sparse?:{indices?:{bufferView?:number};values?:{bufferView?:number}}}[];
 images?:{bufferView?:number;mimeType?:string;uri?:string}[];
 textures?:{sampler?:number;source?:number;extensions?:unknown}[];
 samplers?:{minFilter?:number;magFilter?:number;wrapS?:number;wrapT?:number}[];
 materials?:{
  extensions?:unknown;normalTexture?:unknown;occlusionTexture?:unknown;emissiveTexture?:unknown;
  pbrMetallicRoughness?:{baseColorTexture?:TextureRef;metallicRoughnessTexture?:unknown};
 }[];
};

function removeExif(png:Buffer){
 if(!png.subarray(0,8).equals(PNG_SIGNATURE))return fail();
 const chunks=[png.subarray(0,8)];
 let header=false,colour=false,exif=false,data=false,end=false;
 for(let offset=8;offset<png.length;){
  if(end||png.length-offset<12)return fail();
  const size=png.readUInt32BE(offset),next=offset+12+size;
  if(next>png.length)return fail();
  const chunk=png.subarray(offset,next),tag=chunk.toString('ascii',4,8);
  if(crc32(chunk.subarray(4,8+size))!==chunk.readUInt32BE(8+size))return fail();
  if(tag==='IHDR'&&!header&&offset===8&&size===13&&chunk[16]===8&&chunk[17]===2)header=true;
  else if(tag==='sRGB'&&header&&!colour&&!exif&&!data&&size===1)colour=true;
  else if(tag==='eXIf'&&header&&!exif&&!data&&size>0&&size<=65536)exif=true;
  else if(tag==='IDAT'&&header&&size>0)data=true;
  else if(tag==='IEND'&&data&&size===0)end=true;
  else return fail();
  if(tag!=='eXIf')chunks.push(chunk);
  offset=next;
 }
 if(!exif||!end)return fail();
 return Buffer.concat(chunks);
}

/** Only the legacy single RGB base-color texture case is eligible. The output
 * keeps all geometry bytes and PNG chunks except eXIf. A separate worker
 * must still admit the resulting GLB through the ordinary validator. */
export function prepareLegacyInfoStand(source:Buffer):Buffer{
 if(source.length<28||source.length>MAX_INFO_STAND_SOURCE_BYTES||source.toString('ascii',0,4)!=='glTF'||
    source.readUInt32LE(4)!==2||source.readUInt32LE(8)!==source.length||source.readUInt32LE(16)!==0x4e4f534a)return fail();
 const end=20+source.readUInt32LE(12);
 if(end%4||end+8>source.length||source.readUInt32LE(end+4)!==0x004e4942||source.readUInt32LE(end)!==source.length-end-8)return fail();
 const bin=source.subarray(end+8),doc=JSON.parse(source.toString('utf8',20,end)) as SourceDocument;
 if(!doc||doc.extensionsUsed?.length||doc.extensionsRequired?.length||doc.buffers?.length!==1||doc.buffers[0]?.uri!==undefined||
    doc.images?.length!==1||doc.textures?.length!==1||doc.samplers?.length!==1||!Array.isArray(doc.bufferViews)||
    !Array.isArray(doc.accessors)||!Array.isArray(doc.materials))return fail();
 const image=doc.images[0],texture=doc.textures[0],sampler=doc.samplers[0],buffer=doc.buffers[0],viewIndex=image?.bufferView;
 if(image?.mimeType!=='image/png'||image.uri!==undefined||viewIndex===undefined||!Number.isSafeInteger(viewIndex)||
    texture?.source!==0||texture.sampler!==0||texture.extensions!==undefined||sampler?.magFilter!==9729||
    sampler.minFilter!==9987||!buffer||!Number.isSafeInteger(buffer.byteLength)||buffer.byteLength>bin.length||buffer.byteLength<bin.length-3)return fail();
 const view=doc.bufferViews[viewIndex],start=view?.byteOffset??0;
 if(!view||view.buffer!==0||view.target!==undefined||view.byteStride!==undefined||!Number.isSafeInteger(start)||start<0||start%4||
    !Number.isSafeInteger(view.byteLength)||view.byteLength<12||start+view.byteLength!==buffer.byteLength)return fail();
 if(doc.bufferViews.some((other,index)=>index!==viewIndex&&(other.buffer!==0||!Number.isSafeInteger(other.byteOffset??0)||
    (other.byteOffset??0)<0||!Number.isSafeInteger(other.byteLength)||other.byteLength<1||(other.byteOffset??0)+other.byteLength>start))||
    doc.accessors.some(accessor=>accessor.bufferView===viewIndex||accessor.sparse?.indices?.bufferView===viewIndex||accessor.sparse?.values?.bufferView===viewIndex)||
    !doc.materials.some(material=>material.pbrMetallicRoughness?.baseColorTexture?.index===0)||
    doc.materials.some(material=>material.extensions!==undefined||material.normalTexture!==undefined||material.occlusionTexture!==undefined||
      material.emissiveTexture!==undefined||material.pbrMetallicRoughness?.metallicRoughnessTexture!==undefined))return fail();
 const png=removeExif(bin.subarray(start,start+view.byteLength));
 sampler.minFilter=9729;
 view.byteLength=png.length;
 buffer.byteLength=start+png.length;
 const json=Buffer.from(JSON.stringify(doc)),paddedJson=Buffer.alloc(Math.ceil(json.length/4)*4,32);
 json.copy(paddedJson);
 const paddedBin=Buffer.alloc(Math.ceil(buffer.byteLength/4)*4);
 bin.copy(paddedBin,0,0,start);
 png.copy(paddedBin,start);
 const header=Buffer.from(source.subarray(0,20)),binHeader=Buffer.from(source.subarray(end,end+8));
 header.writeUInt32LE(28+paddedJson.length+paddedBin.length,8);
 header.writeUInt32LE(paddedJson.length,12);
 binHeader.writeUInt32LE(paddedBin.length,0);
 return Buffer.concat([header,paddedJson,binHeader,paddedBin]);
}
