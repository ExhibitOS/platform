// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {prepareProductImageInWorker} from './product-image-preparation-process.ts';
import {imageHash,prepareProductImageThumbnail,PRODUCT_IMAGE_PROFILE,PRODUCT_IMAGE_RECIPE_SHA256} from './product-image-preparation.ts';
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
 const x=111,y=72,sx=Math.floor((x+.5)*width/256),sy=Math.floor((y+.5)*height/171);
 expect(preview.data.subarray((y*256+x)*3,(y*256+x)*3+3)).toEqual(full.subarray((sy*width+sx)*3,(sy*width+sx)*3+3));
 await expect(prepareProductImageInWorker(jpeg,{...identity,sha256:'f'.repeat(64)})).rejects.toMatchObject({code:'IMAGE_PREPARATION_INPUT_INTEGRITY'});
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
