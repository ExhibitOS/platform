// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {pngCrc} from './png-pixels.ts';
import {parseThumbnailCandidate,parseRenderedThumbnail,validateThumbnailBytes} from './artwork-thumbnail.ts';
import {validateCoverImage} from './cover-images.ts';
import {decode} from './imports.ts';
function chunk(name:string,data:Buffer){const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);}
function image(width:number,height:number){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((width*4+1)*height);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
it('decodes the entire PNG and rejects oversized, truncated or corrupt inputs',async()=>{
 const good=image(256,32);expect(await validateThumbnailBytes(good)).toEqual({width:256,height:32});
 await expect(validateThumbnailBytes(image(257,1))).rejects.toThrow('ARTWORK_THUMBNAIL_INVALID');
 await expect(validateThumbnailBytes(good.subarray(0,33))).rejects.toThrow('ARTWORK_THUMBNAIL_INVALID');
 const corrupt=Buffer.from(good);corrupt[29]=corrupt[29]!^1;await expect(validateThumbnailBytes(corrupt)).rejects.toThrow('ARTWORK_THUMBNAIL_INVALID');
});
it('accepts only bounded closed candidate envelopes without treating their claims as authority',()=>{
 const value={requestId:'f0000000-0000-4000-8000-000000000001',expectedRevision:1,sourceAssetId:'f0000000-0000-4000-8000-000000000002',sourceSha256:'a'.repeat(64),thumbnailAssetId:'f0000000-0000-4000-8000-000000000003',thumbnailSha256:'b'.repeat(64),expectedSelectionVersion:0,view:{kind:'default'}};
 expect(parseThumbnailCandidate(value)).toMatchObject({expectedRevision:1,expectedSelectionVersion:0,view:{kind:'default'}});
 for(const bad of [{...value,approved:true},{...value,expectedRevision:0},{...value,sourceSha256:'z'.repeat(64)},{...value,expectedSelectionVersion:-1},{...value,thumbnailAssetId:value.sourceAssetId},{...value,view:{kind:'default',url:'private'}}])expect(()=>parseThumbnailCandidate(bad)).toThrow('INVALID_INPUT');
});
it('accepts only the ten-field rendered envelope, canonical base64 and default view',async()=>{
 const png=image(256,256),value={kind:'rendered-display-preview-v1',requestId:'f0000000-0000-4000-8000-000000000001',expectedRevision:1,sourceAssetId:'f0000000-0000-4000-8000-000000000002',sourceSha256:'a'.repeat(64),displaySha256:'b'.repeat(64),pngSha256:'c'.repeat(64),pngBase64:png.toString('base64'),expectedSelectionVersion:0,view:{kind:'default'}};
 expect(parseRenderedThumbnail(value).png).toEqual(png);expect(await validateThumbnailBytes(png)).toEqual({width:256,height:256});
 for(const bad of [{...value,toolId:'client-claim'},{...value,pngBase64:value.pngBase64+'\n'},{...value,pngBase64:'Zh=='},{...value,pngBase64:Buffer.alloc(512*1024+1).toString('base64')},{...value,view:{kind:'default',orbit:1}},{...value,kind:'unknown'},{...value,expectedRevision:0},{...value,expectedSelectionVersion:-1}])expect(()=>parseRenderedThumbnail(bad)).toThrow('INVALID_INPUT');
});

it('tracks all image validation children and waits for failed registration to close',async()=>{const bytes=image(4,4),closed:boolean[]=[];for(const run of [(onSpawn:(child:import('node:child_process').ChildProcess)=>void)=>decode(bytes,'image/png',{onSpawn}),(onSpawn:(child:import('node:child_process').ChildProcess)=>void)=>validateThumbnailBytes(bytes,{onSpawn}),(onSpawn:(child:import('node:child_process').ChildProcess)=>void)=>validateCoverImage(bytes,{onSpawn})]){let childClosed=false;await expect(run(child=>{child.once('close',()=>{childClosed=true;});throw Error('registration failure');})).rejects.toThrow();closed.push(childClosed);}expect(closed).toEqual([true,true,true]);});
