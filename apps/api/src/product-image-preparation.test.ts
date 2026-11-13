// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {prepareFreshImageInWorker,prepareProductImageInWorker} from './product-image-preparation-process.ts';
import {pngCrc} from './png-pixels.ts';
import {FRESH_IMAGE_RECIPE_SHA256,imageHash,prepareProductImageThumbnail,PRODUCT_IMAGE_PROFILE,PRODUCT_IMAGE_RECIPE_SHA256} from './product-image-preparation.ts';
import {canonicalImageHash,productImageView} from './product-image-intent.ts';

it('prepares the selected JPEG in the product worker and preserves the source identity',async()=>{
 const width=600,height=400;
 const rgb=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const offset=(y*width+x)*3;
  rgb[offset]=x%256;
  rgb[offset+1]=y%256;
  rgb[offset+2]=(x+y)%256;
 }
 const jpeg=await sharp(rgb,{raw:{width,height,channels:3}}).jpeg().toBuffer();
 const identity={sha256:imageHash(jpeg),bytes:jpeg.length};
 const result=await prepareProductImageInWorker(jpeg,identity);
 expect(result.workerDrained).toBe(true);
 expect(result.receipt).toMatchObject({recipeSHA256:PRODUCT_IMAGE_RECIPE_SHA256,
  source:{...identity,mime:'image/jpeg',width,height},
  full:{width,height,sha256:imageHash(result.full)},
 });
 expect(result.coarse).toBeUndefined();
 expect(result.receipt.coarse).toBeUndefined();
 expect(imageHash(jpeg)).toBe(identity.sha256);
 const thumb=prepareProductImageThumbnail(result.full,result.receipt.full);
 const preview=await sharp(thumb).raw().toBuffer({resolveWithObject:true});
 const full=await sharp(result.full).raw().toBuffer();
 expect(preview.info).toMatchObject({width:256,height:171,channels:3});
 const x=111,y=72,left=x*width/256,right=(x+1)*width/256,top=y*height/171,bottom=(y+1)*height/171;
 const expected=[0,0,0];
 for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
  const area=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy));
  for(let c=0;c<3;c++)expected[c]!+=full[(sy*width+sx)*3+c]!*area;
 }
 expect([...preview.data.subarray((y*256+x)*3,(y*256+x)*3+3)]).toEqual(expected.map(sum=>Math.round(sum/((right-left)*(bottom-top)))));
 await expect(prepareProductImageInWorker(jpeg,{...identity,sha256:'f'.repeat(64)})).rejects.toMatchObject({code:'IMAGE_PREPARATION_INPUT_INTEGRITY'});
},30000);

it('integrates high-frequency thumbnail detail instead of aliasing centre samples',async()=>{
 const width=1024,height=1024,rgb=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgb.fill((x+y)%2?255:0,(y*width+x)*3,(y*width+x+1)*3);
 const png=await sharp(rgb,{raw:{width,height,channels:3}}).png().toBuffer();
 const normalized=await prepareFreshImageInWorker(png,{mime:'image/png',sha256:imageHash(png),bytes:png.length});
 const thumbnail=prepareProductImageThumbnail(normalized.full,normalized.receipt.full);
 const decoded=await sharp(thumbnail).raw().toBuffer({resolveWithObject:true});
 expect(decoded.info).toMatchObject({width:256,height:256,channels:3});
 expect(decoded.data.equals(Buffer.alloc(256*256*3,128))).toBe(true);
},30000);

it('accepts the bounded fallback in the durable ready receipt',async()=>{
 const edge=2048,rgb=Buffer.alloc(edge*edge*3);
 let state=123456789;
 for(let index=0;index<rgb.length;index++){
  state^=state<<13;
  state^=state>>>17;
  state^=state<<5;
  rgb[index]=state&255;
 }
 const jpeg=await sharp(rgb,{raw:{width:edge,height:edge,channels:3}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
 const identity={sha256:imageHash(jpeg),bytes:jpeg.length};
 const {receipt:producer}=await prepareProductImageInWorker(jpeg,identity);
 expect(producer.full).toMatchObject({width:1600,height:1600});
 expect(producer.full.bytes).toBeLessThanOrEqual(8*1024*1024);
 const jobId=randomUUID(),artworkId=randomUUID(),workspaceId=randomUUID(),principalId=randomUUID(),tenantId=randomUUID();
 const original={...identity,assetId:randomUUID(),mime:'image/jpeg' as const};
 const full={...producer.full,assetId:randomUUID(),mime:'image/png' as const};
 const coarse={...producer.coarse!,assetId:randomUUID(),mime:'image/png' as const};
 const rights={licenseId:'CC0-1.0'};
 const body={version:1,jobId,artworkId,artworkRevision:1,workspaceId,principalId,rightsSHA256:canonicalImageHash(rights),original,full,coarse,producer};
 const result={...body,sha256:canonicalImageHash(body)};
 const prefix=`${tenantId}/quarantine/import-${jobId}`;
 const row={id:jobId,tenant_id:tenantId,artwork_id:artworkId,user_id:principalId,rights,mime:'image/jpeg',state:'approved',
  expected_bytes:identity.bytes,expected_hash:identity.sha256,png_drain_version:1,png_worker_tokens:[],lease_id:null,
  object_key:`${prefix}/${identity.sha256}`,derived_object_key:`${prefix}/product-full`,
  approved_key:`${tenantId}/approved/${full.sha256}`,asset_id:full.assetId,original_asset_id:original.assetId,
  derived:{kind:'product-image-pair',request:{version:1,profile:PRODUCT_IMAGE_PROFILE,artworkRevision:1},workspaceId,principalId,result}};
 expect(productImageView(row)).toMatchObject({status:'ready',workerDrained:true,full,coarse});
},30000);

it('preserves RGB pixels across filtered PNG scanlines in the fresh worker',async()=>{
 const width=3,height=2;
 const expected=Buffer.from([11,22,33,44,55,66,77,88,99,101,102,103,104,105,106,107,108,109]);
 const original=await sharp(expected,{raw:{width,height,channels:3}}).png({adaptiveFiltering:true}).toBuffer();
 const identity={mime:'image/png' as const,sha256:imageHash(original),bytes:original.length};
 const result=await prepareFreshImageInWorker(original,identity);
 expect(result.workerDrained).toBe(true);
 expect(result.receipt.source).toMatchObject({...identity,width,height});
 const actual=await sharp(result.full).raw().toBuffer();
 expect(actual).toEqual(expected);
},30000);

it('processes a strict PNG above the legacy decoded limit under the distinct fresh receipt',async()=>{
 const width=3072,height=2048;
 const header=Buffer.alloc(13);
 header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*(width*3+1)+1+x*3;
  rows[i]=x%256;rows[i+1]=y%256;rows[i+2]=(x+y)%256;
 }
 const chunk=(name:string,body:Buffer)=>{
  const type=Buffer.from(name),encoded=Buffer.alloc(body.length+12);
  encoded.writeUInt32BE(body.length);type.copy(encoded,4);body.copy(encoded,8);
  encoded.writeUInt32BE(pngCrc(encoded.subarray(4,-4)),encoded.length-4);
  return encoded;
 };
 const original=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
 const identity={mime:'image/png' as const,sha256:imageHash(original),bytes:original.length};
 const result=await prepareFreshImageInWorker(original,identity);
 expect(result).toMatchObject({workerDrained:true,receipt:{recipeSHA256:FRESH_IMAGE_RECIPE_SHA256,
  source:{...identity,width,height,iccSHA256:null},full:{width:2048,height:1365},coarse:{width:512,height:341}}});
 expect(imageHash(original)).toBe(identity.sha256);
},30000);
