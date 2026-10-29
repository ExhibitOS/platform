// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {freezeCanonical} from '@exhibitos/studio-contract';
vi.mock('./drafts/example',()=>({newDraft:()=>({})}));
vi.mock('./drafts/exhibition-validation.mjs',()=>({validateExhibition:()=>({valid:true})}));
vi.mock('./drafts/validator',()=>({validateDraft:()=>({valid:true})}));
import {loadStaticPublication} from './static-publication-source';
const digest=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(options:{badAssetPath?:boolean;badPublicationPath?:boolean;corruptAsset?:boolean}={}){
 const exhibition={id:'synthetic'},assetBytes=Buffer.from('synthetic-public-asset'),assetHash=digest(assetBytes),assetId='synthetic-asset',publicationId='synthetic-publication';
 const publication={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:[{assetId,mime:'image/png',url:`/api/v1/publications/${publicationId}/assets/${assetId}`}]};
 const pub=Buffer.from(JSON.stringify(publication)),pubHash=digest(pub),assetPath=`data/${assetHash}.bin`,pubPath=`data/${pubHash}.json`;
 const index=Buffer.from(JSON.stringify({version:1,publication:{path:options.badPublicationPath?`data/${'a'.repeat(64)}.json`:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:[{assetId,path:options.badAssetPath?`data/${'b'.repeat(64)}.bin`:assetPath,bytes:assetBytes.length,sha256:assetHash,mime:'image/png'}]}));
 vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});
 const requests:{path:string;cache:RequestCache|undefined}[]=[];const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input);requests.push({path,cache:init?.cache});const data=path==='/static-publication-index.json'?index:path==='/'+pubPath||path===`/data/${'a'.repeat(64)}.json`?pub:path==='/'+assetPath||path===`/data/${'b'.repeat(64)}.bin`?(options.corruptAsset?Buffer.from('x'.repeat(assetBytes.length)):assetBytes):undefined;return data?new Response(data):new Response(null,{status:404});});vi.stubGlobal('fetch',fetcher);return {requests,assetPath,pubPath,assetId,publicationId};
}
describe('static publication content-addressed reads',()=>{
 it('keeps the index fresh and uses browser HTTP caching only for verified hashed data',async()=>{
  const s=setup(),publication=await loadStaticPublication();const response=await publication.local!.fetcher(`/api/v1/publications/${s.publicationId}/assets/${s.assetId}`);expect(await response.text()).toBe('synthetic-public-asset');
  expect(s.requests).toEqual([{path:'/static-publication-index.json',cache:'no-store'},{path:'/'+s.pubPath,cache:'default'},{path:'/'+s.assetPath,cache:'default'}]);
 });
 it('uses no-store for legacy mismatched paths and still rejects corrupted bytes',async()=>{
  const pub=setup({badPublicationPath:true});await loadStaticPublication();expect(pub.requests[1]!.cache).toBe('no-store');
  const asset=setup({badAssetPath:true}),legacy=await loadStaticPublication();await legacy.local!.fetcher(`/api/v1/publications/${asset.publicationId}/assets/${asset.assetId}`);expect(asset.requests[2]!.cache).toBe('no-store');
  const corrupted=setup({corruptAsset:true}),publication=await loadStaticPublication();await expect(publication.local!.fetcher(`/api/v1/publications/${corrupted.publicationId}/assets/${corrupted.assetId}`)).rejects.toThrow('STATIC_ASSET_HASH');
 });
 it('resolves only the declared v2 resource through its verified publication-scoped URL',async()=>{
  const id='synthetic-publication',exhibition={id:'synthetic',extensions:{'org.exhibitos.viewer/footstep-resources':{version:1,families:['wood']}}};
  const selected=footstepResourcesFor(exhibition),resources=selected.map(x=>({sha256:x.sha256,bytes:x.bytes,mime:x.mime,url:`/api/v1/publications/${id}/resources/${x.sha256}`}));
  const value={publication:{id,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:[],resources};
  const pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
  const index=Buffer.from(JSON.stringify({version:2,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:[],resources:selected.map(x=>({path:`data/${x.sha256}.bin`,bytes:x.bytes,sha256:x.sha256,mime:x.mime}))}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});
  const bytes=new Map<string,Uint8Array>();for(const item of selected)bytes.set(`/data/${item.sha256}.bin`,await readFile(new URL('../public/'+item.artifactPath,import.meta.url)));
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:bytes.get(path);return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  const result=await loadStaticPublication(),sample=resources.find(r=>r.mime==='audio/wav')!;
  expect(digest(new Uint8Array(await (await result.local!.fetcher(sample.url)).arrayBuffer()))).toBe(sample.sha256);
  await expect(result.local!.fetcher(`/api/v1/publications/${id}/resources/${'0'.repeat(64)}`)).rejects.toThrow('STATIC_ASSET_URL');
 });
});
