// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {deflateSync,inflateSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {derivative} from './derivative.ts';
function crc(bytes:Buffer){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=value>>>1^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(name:string,body:Buffer){const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);head.write(name,4);tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4),body])));return Buffer.concat([head,body,tail]);}
function png(width=256,height=128){const header=Buffer.alloc(13),rows=Buffer.alloc((width*3+1)*height);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;for(let y=0;y<height;y++)for(let x=0;x<width;x++)rows.set([100,150,200],y*(width*3+1)+1+x*3);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('sRGB',Buffer.from([1])),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function pixels(bytes:Buffer){const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),channels=bytes[25]===2?3:4,idat:Buffer[]=[],tags:string[]=[];for(let at=8;at<bytes.length;){const size=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8);tags.push(name);if(name==='IDAT')idat.push(bytes.subarray(at+8,at+8+size));at+=12+size;}return {width,height,channels,tags,rows:inflateSync(Buffer.concat(idat))};}
test('new none and overlay copies keep suitable bytes, while quality resize stays clean and colour-tagged',async()=>{
 const source=png(),before=Buffer.from(source);expect(await derivative(source,'image/png')).toEqual(source);expect(await derivative(source,'image/png',{watermark:{version:1,mode:'overlay',text:'작가 · 출처'}})).toEqual(source);expect(source).toEqual(before);
 const resized=pixels(await derivative(png(1024,512),'image/png'));expect([resized.width,resized.height,resized.channels]).toEqual([512,256,3]);expect(resized.tags).toContain('sRGB');expect([...resized.rows.subarray(1,4)]).toEqual([100,150,200]);
});
test('explicit embedded PNG adds one bounded label and rejects unsupported text without changing the source',async()=>{
 const source=png(),before=Buffer.from(source),result=pixels(await derivative(source,'image/png',{watermark:{version:1,mode:'embedded',size:12,opacity:.25,position:'bottom-right'}}));let changed=0;
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){const at=y*(result.width*result.channels+1)+1+x*result.channels;if(result.rows[at]!==100){changed++;expect(y).toBeGreaterThanOrEqual(result.height*.75);expect(x).toBeGreaterThanOrEqual(result.width*.5);}}
 expect(changed).toBeGreaterThan(0);expect(changed).toBeLessThan(result.width*result.height*.1);expect(source).toEqual(before);
 await expect(derivative(source,'image/png',{watermark:{version:1,mode:'embedded',text:'한글'}})).rejects.toMatchObject({code:'WATERMARK_TEXT_UNSUPPORTED'});
});
test('clean model output is byte-identical with no ribbon and retains the ordinary display profile guard',async()=>{
 const {exhibition,files,manifest}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),art=exhibition.artworks.find(a=>a.artworkType==='sculpture')!,entry=manifest.assets.find(a=>a.id===art.primaryAssetId)!,source=Buffer.from(files.get(entry.path)!);
 expect(await derivative(source,'model/gltf-binary')).toEqual(source);expect(await derivative(source,'model/gltf-binary',{watermark:{version:1,mode:'embedded'}})).toEqual(source);
 const size=source.readUInt32LE(12),doc=JSON.parse(source.toString('utf8',20,20+size));doc.nodes[0].translation=[1,0,0];const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),header=Buffer.from(source.subarray(0,20)),tail=source.subarray(20+size);header.writeUInt32LE(20+padded.length+tail.length,8);header.writeUInt32LE(padded.length,12);
 await expect(derivative(Buffer.concat([header,padded,tail]),'model/gltf-binary')).rejects.toMatchObject({code:'DERIVATIVE_FAILED'});
});
