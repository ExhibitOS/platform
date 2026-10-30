// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {freezeCanonical,applyBenchCommand,applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {fixtureURL,readOex} from '@exhibitos/spec';
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
 it('binds a selected furnishing model and notice to the version3 source and rejects changed notice bytes',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),doc=original.exhibition,room=doc.rooms[0]!,id=randomUUID(),viewpointId=randomUUID(),publicationId=randomUUID(),catalog=furnishingCatalogueEntry('backless-oak-bench'),{min,max}=catalog.bounds;
  const bench={id,name:'bench',roomId:room.id,position:[0,0,0] as [number,number,number],yaw:0,kind:'slab' as const,dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood' as const,color:'#755741',roughness:.7,metalness:0},viewpointId};
  const base=applyBenchCommand(doc,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}}),exhibition=applyFurnishingCommand(base,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}}),asset=furnishingsFor(exhibition)!.assets[0]!,model=await readFile(new URL('../../../'+catalog.path,import.meta.url)),notice=await readFile(new URL('../../../'+catalog.rights.noticePath,import.meta.url));
  const assets=[...original.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,bytes:a.bytes,sha256:a.sha256})),{assetId:asset.id,mime:asset.mime,bytes:asset.bytes,sha256:asset.sha256}],declared={assetId:asset.id,bytes:notice.length,sha256:digest(notice),mime:'text/plain; charset=utf-8',url:`/api/v1/publications/${publicationId}/furnishing-notices/${asset.id}`};
  const value={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:assets.map(a=>({assetId:a.assetId,mime:a.mime,url:`/api/v1/publications/${publicationId}/assets/${a.assetId}`})),furnishingNotices:[declared]},pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
  const index=Buffer.from(JSON.stringify({version:3,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:assets.map(a=>({...a,path:`data/${a.sha256}.bin`})),furnishingNotices:[{assetId:asset.id,path:`data/${declared.sha256}.bin`,bytes:declared.bytes,sha256:declared.sha256,mime:declared.mime}]}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});let corrupt=false;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:path===`/data/${asset.sha256}.bin`?model:path===`/data/${declared.sha256}.bin`?(corrupt?Buffer.alloc(notice.length):notice):undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  const result=await loadStaticPublication();expect(new Uint8Array(await (await result.local!.fetcher(value.assets.at(-1)!.url)).arrayBuffer())).toEqual(new Uint8Array(model));expect(await (await result.local!.fetcher(declared.url)).text()).toBe(notice.toString());corrupt=true;await expect(result.local!.fetcher(declared.url)).rejects.toThrow('STATIC_ASSET_HASH');
 });
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
