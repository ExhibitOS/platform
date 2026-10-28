// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import * as generator from './derivative.ts';
import {cachedDisplayDerivative} from './display-derivative-cache.ts';
test('recipe reuse shares clean none/overlay bytes, distinguishes quality/embed, and refuses corrupt cache/source',async()=>{
 // Cache/ownership unit only; the real worker is qualified separately.
 const source=Buffer.from('approved synthetic source'),hash=createHash('sha256').update(source).digest('hex'),rows=new Map<string,{metadata:Record<string,unknown>}>(),objects=new Map<string,Buffer>();
 const query=vi.fn(async(sql:string,values:unknown[])=>{const key=String(values[0])+':'+String(values[1]);if(sql.startsWith('SELECT'))return {rows:rows.has(key)?[rows.get(key)]:[]};if(sql.startsWith('INSERT'))rows.set(key,{metadata:values[2] as Record<string,unknown>});return {rows:[]};});
 const blobs={get:async(key:string)=>objects.get(key)!,put:async(key:string,bytes:Uint8Array)=>{objects.set(key,Buffer.from(bytes));}} as unknown as BlobStore;
 const cache={client:{query} as unknown as PoolClient,blobs,tenantId:'11111111-1111-4111-8111-111111111111',assetId:'22222222-2222-4222-8222-222222222222',sourceSha256:hash};
 const generate=vi.spyOn(generator,'derivative').mockResolvedValue(Buffer.from('synthetic viewing output'));
 try{
  const first=await cachedDisplayDerivative(source,'image/png',{},cache);
  expect(await cachedDisplayDerivative(source,'image/png',{watermark:{version:1,mode:'overlay',text:'작가 · 출처'}},cache)).toEqual(first);expect(generate).toHaveBeenCalledTimes(1);
  await cachedDisplayDerivative(source,'image/png',{maxTextureSize:2048},cache);await cachedDisplayDerivative(source,'image/png',{watermark:{version:1,mode:'embedded',text:'Author'}},cache);expect(generate).toHaveBeenCalledTimes(3);expect(rows.size).toBe(3);
  const ordinary=[...rows.values()].find(row=>(row.metadata.recipe as {quality:{maxTextureSize:number};watermark:{mode:string}}).quality.maxTextureSize===512&&(row.metadata.recipe as {watermark:{mode:string}}).watermark.mode==='none')!;
  objects.set(String(ordinary.metadata.objectKey),Buffer.from('corrupt'));
  await expect(cachedDisplayDerivative(source,'image/png',{},cache)).rejects.toMatchObject({code:'DERIVATIVE_INTEGRITY'});expect(generate).toHaveBeenCalledTimes(3);
  const before=query.mock.calls.length;await expect(cachedDisplayDerivative(source,'image/png',{}, {...cache,sourceSha256:'0'.repeat(64)})).rejects.toMatchObject({code:'ASSET_INTEGRITY'});expect(query).toHaveBeenCalledTimes(before);
  await expect(cachedDisplayDerivative(source,'image/png',{watermark:{version:1,mode:'embedded',text:'ß'}},cache)).rejects.toMatchObject({code:'WATERMARK_TEXT_UNSUPPORTED'});expect(query).toHaveBeenCalledTimes(before);expect(generate).toHaveBeenCalledTimes(3);
 }finally{generate.mockRestore();}
});
