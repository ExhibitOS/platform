// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {pngCrc} from './png-pixels.ts';
import {parseThumbnailCandidate,validateThumbnailBytes} from './artwork-thumbnail.ts';
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
