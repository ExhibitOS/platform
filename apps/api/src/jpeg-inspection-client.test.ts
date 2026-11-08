// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';

it('fully decodes a synthetic baseline JPEG in the owned worker and rejects missing EOI',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:{r:30,g:80,b:120}}}).jpeg({progressive:false}).toBuffer(),result=await inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000)) as Record<string,unknown>;
 expect(result).toMatchObject({version:1,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes.length,width:4,height:3,decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'});
 await expect(inspectJpegInOwnedWorker(bytes.subarray(0,bytes.length-2),AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
});
it('waits for a cancelled child to close before returning',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),controller=new AbortController();let closed=false;
 await expect(inspectJpegInOwnedWorker(bytes,controller.signal,{onSpawn:child=>{child.once('close',()=>{closed=true;});controller.abort();}})).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');expect(closed).toBe(true);
});
