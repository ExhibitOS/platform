// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {prepareProductImageInWorker} from './product-image-preparation-process.ts';
import {imageHash,PRODUCT_IMAGE_RECIPE_SHA256} from './product-image-preparation.ts';

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
  coarse:{width:512,height:341,sha256:imageHash(result.coarse!)},
 });
 expect(imageHash(jpeg)).toBe(identity.sha256);
 await expect(prepareProductImageInWorker(jpeg,{...identity,sha256:'f'.repeat(64)})).rejects.toMatchObject({code:'IMAGE_PREPARATION_INPUT_INTEGRITY'});
},30000);
