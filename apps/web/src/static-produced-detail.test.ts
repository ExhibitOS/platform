// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadStaticPublication} from './static-publication-source.ts';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it.skipIf(!process.env.NATIVE_DETAIL_V4_CAPTURE)('loads produced synthetic v4 through the real static Viewer source',async()=>{
 const root=process.env.NATIVE_DETAIL_V4_CAPTURE!,indexBytes=await readFile(join(root,'static-publication-index.json')),index=JSON.parse(indexBytes.toString()),value=JSON.parse(await readFile(join(root,index.publication.path),'utf8'));expect(index.version).toBe(4);expect(index.detailAssets).toHaveLength(1);expect(value.detailAssets).toHaveLength(1);
 vi.stubGlobal('document',{querySelector:()=>({content:createHash('sha256').update(indexBytes).digest('hex')})});let absent=false;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(!/^\/(?:static-publication-index\.json|data\/[a-f0-9]{64}\.(?:json|bin))$/.test(path)||absent&&path===`/${index.detailAssets[0].path}`)return new Response(null,{status:404});try{return new Response(new Uint8Array(await readFile(join(root,path.slice(1)))));}catch{return new Response(null,{status:404});}}));
 const publication=await loadStaticPublication(),descriptor=value.detailAssets[0],response=await publication.local!.fetcher(descriptor.url);expect(await response.text()).toBe('synthetic detail bytes, not an original artwork');expect(response.headers.get('x-exhibitos-publication-revision')).toBe(value.publication.revisionSha256);absent=true;await expect(publication.local!.fetcher(descriptor.url)).rejects.toThrow();expect(publication.exhibition.id).toBe(value.exhibition.id);
});
