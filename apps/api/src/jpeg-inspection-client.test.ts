// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';

it('fully decodes a synthetic baseline JPEG in the owned worker and rejects missing EOI',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:{r:30,g:80,b:120}}}).jpeg({progressive:false}).toBuffer(),original=Buffer.from(bytes),result=await inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000),{onSpawn:()=>bytes.fill(0)});
 expect(result.receipt).toMatchObject({version:1,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceBytes:original.length,width:4,height:3,decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'});expect(result.bytes.equals(original)).toBe(true);
 await expect(inspectJpegInOwnedWorker(original.subarray(0,original.length-2),AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
});
it('waits for a cancelled child to close before returning',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),controller=new AbortController();let closed=false;
 await expect(inspectJpegInOwnedWorker(bytes,controller.signal,{onSpawn:child=>{child.once('close',()=>{closed=true;});controller.abort();}})).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');expect(closed).toBe(true);
});
it('does not start a second worker and rejects shared mutable input',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),first=inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000));
 await expect(inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');await first;
 const shared=Buffer.from(new SharedArrayBuffer(bytes.length));bytes.copy(shared);await expect(inspectJpegInOwnedWorker(shared,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
 const crossRealm=Buffer.from(runInNewContext(`new SharedArrayBuffer(${bytes.length})`) as ArrayBuffer);bytes.copy(crossRealm);await expect(inspectJpegInOwnedWorker(crossRealm,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
});
