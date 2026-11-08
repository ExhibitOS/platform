// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {freezeCanonical,applyBenchCommand,applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry,ARTWORK_DETAIL_QUALITY_NAMESPACE} from '@exhibitos/studio-contract';
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
 const requests:{path:string;cache:RequestCache|undefined}[]=[];const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input);requests.push({path,cache:init?.cache});const data=path==='/static-publication-index.json'?index:path==='/'+pubPath||path===`/data/${'a'.repeat(64)}.json`?pub:path==='/'+assetPath||path===`/data/${'b'.repeat(64)}.bin`?(options.corruptAsset?Buffer.from('x'.repeat(assetBytes.length)):assetBytes):undefined;return data?new Response(data):new Response(null,{status:404});});vi.stubGlobal('fetch',fetcher);return {requests,assetPath,pubPath,assetId,publicationId,indexDigest:digest(index)};
}
describe('static publication content-addressed reads',()=>{
 it('validates the active v4 publication before allowing a previous copy to reopen',async()=>{
  const exhibition={id:'synthetic',artworks:[],mediaAssets:[]},publicationId='synthetic-publication',revision=digest(freezeCanonical(exhibition));
  const oldValue={publication:{id:publicationId,status:'published',revisionSha256:revision},exhibition,assets:[]},activeValue={...oldValue,detailAssets:[]};
  const make=(value:unknown,version:number)=>{const pub=Buffer.from(JSON.stringify(value)),sha=digest(pub),path=`data/${sha}.json`,index=Buffer.from(JSON.stringify({version,publication:{path,bytes:pub.length,sha256:sha,mime:'application/json'},assets:[],...(version===4?{detailAssets:[]}:{})}));return {pub,path,index};};
  let old=make(oldValue,1),active=make(activeValue,4);
  let oldHash=digest(old.index);vi.stubGlobal('document',{querySelector:()=>({content:digest(active.index)})});
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path===`/private-copy-bases/${oldHash}/static-publication-index.json`?old.index:path===`/private-copy-bases/${oldHash}/${old.path}`?old.pub:path==='/static-publication-index.json'?active.index:path==='/'+active.path?active.pub:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  expect((await loadStaticPublication(oldHash)).publication.revisionSha256).toBe(revision);
  active=make({...activeValue,publication:{...activeValue.publication,status:'unpublished'}},4);
  await expect(loadStaticPublication(oldHash)).rejects.toThrow('STATIC_PUBLICATION');
  active=make(activeValue,4);old=make(activeValue,4);oldHash=digest(old.index);
  await expect(loadStaticPublication(oldHash)).rejects.toThrow('STATIC_PREVIOUS_ASSETS');
 });
 it('checks v4 detail bindings independently and keeps the gallery if the optional file is missing',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),exhibition=structuredClone(original.exhibition),work=exhibition.artworks.find(a=>a.artworkType==='image')!,publicationId=randomUUID(),assetId=randomUUID(),bytes=Buffer.from('synthetic detail'),sha=digest(bytes);
  work.rights.permissions.download=true;work.rights.permissions.export=true;
  const featureReport={version:1,inspector:'synthetic-only',assetSha256:sha,assetBytes:bytes.length,media:{kind:'image',codec:'png',width:1,height:1,bitDepth:8,channels:4,frameCount:1,interlaced:false,orientation:1,colourProfile:'srgb'},cost:{model:'synthetic-only',residentBytes:4,peakAdditionalBytes:8}};
  const candidate={candidateId:randomUUID(),assetId,tier:'acquired-original',sha256:sha,bytes:bytes.length,mime:'image/png',sourceBindingSha256:'a'.repeat(64),featureReportSha256:digest(freezeCanonical(featureReport)),featureReport};
  work.extensions={...work.extensions,[ARTWORK_DETAIL_QUALITY_NAMESPACE]:{version:1,candidates:[candidate]}} as never;
  const descriptor={assetId,mime:'image/png',url:`/api/v1/publications/${publicationId}/detail-assets/${assetId}`};
  const value={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:original.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,url:`/api/v1/publications/${publicationId}/assets/${a.id}`})),detailAssets:[descriptor]};
  const pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`,assets=original.manifest.assets.map(a=>({assetId:a.id,path:`data/${a.sha256}.bin`,bytes:a.bytes,sha256:a.sha256,mime:a.mime})),detailEntry={assetId,path:`data/${sha}.bin`,bytes:bytes.length,sha256:sha,mime:'image/png'};
  const indexFor=(entry:unknown)=>Buffer.from(JSON.stringify({version:4,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets,detailAssets:[entry]}));
  let index=indexFor(detailEntry),available=true;
  vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:path===`/data/${sha}.bin`&&available?bytes:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  const result=await loadStaticPublication();expect(await (await result.local!.fetcher(descriptor.url)).text()).toBe('synthetic detail');
  const ordinaryUrl=result.assets[0]!.url,revision=value.publication.revisionSha256;result.assets[0]!.url=descriptor.url;result.publication.revisionSha256='f'.repeat(64);
  const isolated=await result.local!.fetcher(descriptor.url);expect(await isolated.text()).toBe('synthetic detail');expect(isolated.headers.get('x-exhibitos-publication-revision')).toBe(revision);result.assets[0]!.url=ordinaryUrl;result.publication.revisionSha256=revision;
  result.exhibition.artworks.find(a=>a.id===work.id)!.rights.permissions.download=false;expect(await (await result.local!.fetcher(descriptor.url)).text()).toBe('synthetic detail');result.exhibition.artworks.find(a=>a.id===work.id)!.rights.permissions.download=true;
  available=false;await expect(result.local!.fetcher(descriptor.url)).rejects.toThrow('STATIC_RESPONSE');expect(result.exhibition.id).toBe(exhibition.id);
  index=indexFor({...detailEntry,bytes:bytes.length+1});await expect(loadStaticPublication()).rejects.toThrow('STATIC_DETAIL');
  index=Buffer.from(JSON.stringify({version:4,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets,detailAssets:Array(17).fill(detailEntry)}));await expect(loadStaticPublication()).rejects.toThrow('STATIC_INDEX');
  const legacyValue={publication:value.publication,exhibition,assets:value.assets},legacyPub=Buffer.from(JSON.stringify(legacyValue)),legacyHash=digest(legacyPub),legacyPath=`data/${legacyHash}.json`;
  const legacyIndex=Buffer.from(JSON.stringify({version:1,publication:{path:legacyPath,bytes:legacyPub.length,sha256:legacyHash,mime:'application/json'},assets}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(legacyIndex)})});vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const body=String(input)==='/static-publication-index.json'?legacyIndex:legacyPub;return new Response(new Uint8Array(body));}));
  await expect(loadStaticPublication()).rejects.toThrow('STATIC_DETAIL');
 });
 it('rejects duplicate keys in the hash-pinned index and publication before exposure',async()=>{
  const duplicateIndex=Buffer.from('{"version":1,"\\u0076ersion":1}');
  vi.stubGlobal('document',{querySelector:()=>({content:digest(duplicateIndex)})});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(duplicateIndex)));
  await expect(loadStaticPublication()).rejects.toThrow('STATIC_JSON_INVALID');
  const pub=Buffer.from('{"publication":{},"exhibition":{},"\\u0065xhibition":{}}'),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
  const index=Buffer.from(JSON.stringify({version:1,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:[]}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Response(String(input)==='/static-publication-index.json'?index:pub)));
  await expect(loadStaticPublication()).rejects.toThrow('STATIC_JSON_INVALID');
 });
 it('binds a selected furnishing model and notice to the version3 source and rejects changed notice bytes',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),doc=original.exhibition,room=doc.rooms[0]!,id=randomUUID(),viewpointId=randomUUID(),publicationId=randomUUID(),catalog=furnishingCatalogueEntry('backless-oak-bench'),{min,max}=catalog.bounds;
  const bench={id,name:'bench',roomId:room.id,position:[0,0,0] as [number,number,number],yaw:0,kind:'slab' as const,dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood' as const,color:'#755741',roughness:.7,metalness:0},viewpointId};
  const base=applyBenchCommand(doc,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}}),exhibition=applyFurnishingCommand(base,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}}),asset=furnishingsFor(exhibition)!.assets[0]!,model=await readFile(new URL('../../../'+catalog.path,import.meta.url)),notice=await readFile(new URL('../../../'+catalog.rights.noticePath,import.meta.url));
  const assets=[...original.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,bytes:a.bytes,sha256:a.sha256})),{assetId:asset.id,mime:asset.mime,bytes:asset.bytes,sha256:asset.sha256}],declared={assetId:asset.id,bytes:notice.length,sha256:digest(notice),mime:'text/plain; charset=utf-8',url:`/api/v1/publications/${publicationId}/furnishing-notices/${asset.id}`};
  const value={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:assets.map(a=>({assetId:a.assetId,mime:a.mime,url:`/api/v1/publications/${publicationId}/assets/${a.assetId}`})),furnishingNotices:[declared]},pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
  const index=Buffer.from(JSON.stringify({version:3,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:assets.map(a=>({...a,path:`data/${a.sha256}.bin`})),furnishingNotices:[{assetId:asset.id,path:`data/${declared.sha256}.bin`,bytes:declared.bytes,sha256:declared.sha256,mime:declared.mime}]}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});let corrupt=false;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:path===`/data/${asset.sha256}.bin`?model:path===`/data/${declared.sha256}.bin`?(corrupt?Buffer.alloc(notice.length):notice):undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  const result=await loadStaticPublication();expect(new Uint8Array(await (await result.local!.fetcher(value.assets.at(-1)!.url)).arrayBuffer())).toEqual(new Uint8Array(model));expect(await (await result.local!.fetcher(declared.url)).text()).toBe(notice.toString());corrupt=true;await expect(result.local!.fetcher(declared.url)).rejects.toThrow('STATIC_ASSET_HASH');
  const malformed={...value,assets:[...value.assets.slice(0,-1),value.assets[0]!]};
  const malformedPub=Buffer.from(JSON.stringify(malformed)),malformedHash=digest(malformedPub),malformedPath=`data/${malformedHash}.json`,malformedIndex=Buffer.from(JSON.stringify({...JSON.parse(index.toString()),publication:{path:malformedPath,bytes:malformedPub.length,sha256:malformedHash,mime:'application/json'}}));
  vi.stubGlobal('document',{querySelector:()=>({content:digest(malformedIndex)})});vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?malformedIndex:path==='/'+malformedPath?malformedPub:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
  await expect(loadStaticPublication()).rejects.toThrow('STATIC_ASSETS');
 });
 it('keeps the index fresh and uses browser HTTP caching only for verified hashed data',async()=>{
  const s=setup(),publication=await loadStaticPublication();expect(publication.local?.verifiedIndexSha256).toBe(s.indexDigest);const response=await publication.local!.fetcher(`/api/v1/publications/${s.publicationId}/assets/${s.assetId}`);expect(await response.text()).toBe('synthetic-public-asset');
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

it.each([{version:1,kind:'pedestal'},{version:2,kind:'stool'},{version:3,kind:'partition'},{version:3,kind:'info-stand'},{version:3,kind:'barrier'},{version:3,kind:'display-case'}])('requires the canonical content-addressed path for workspace furnishing $kind before model I/O',async({version,kind})=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),exhibition=original.exhibition,publicationId=randomUUID(),assetId=randomUUID(),room=exhibition.rooms[0]!,model=Buffer.from('synthetic GLB content'),sha=digest(model),url=`/api/v1/publications/${publicationId}/assets/${assetId}`;
 const furnishing={id:assetId,version:1,kind,name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Provided by the exhibition editor.',model:{mime:'model/gltf-binary',bytes:model.length,sha256:sha}};exhibition.extensions={...exhibition.extensions,'org.exhibitos.studio/workspace-furnishings':{version,furnishings:[furnishing],placements:[{id:randomUUID(),roomId:room.id,furnishingId:assetId,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]}} as never;
 const value={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:[{assetId,mime:'model/gltf-binary',url}]},pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
 const indexFor=(path:string)=>Buffer.from(JSON.stringify({version:1,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:[{assetId,path,bytes:model.length,sha256:sha,mime:'model/gltf-binary'}]}));
 const install=(index:Buffer)=>{vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:path===`/data/${sha}.bin`?model:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});});vi.stubGlobal('fetch',fetcher);return fetcher;};
 install(indexFor(`data/${sha}.bin`));const accepted=await loadStaticPublication();expect(await (await accepted.local!.fetcher(url)).arrayBuffer()).toEqual(new Uint8Array(model).buffer);
 const denied=install(indexFor(`data/${'b'.repeat(64)}.bin`));await expect(loadStaticPublication()).rejects.toThrow('STATIC_WORKSPACE_FURNISHING');expect(denied).toHaveBeenCalledTimes(2);
});

it('binds public workspace wall map to its exact content-addressed asset',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),exhibition=original.exhibition,publicationId=randomUUID(),assetId=randomUUID(),wall=exhibition.surfaces.find(s=>s.type==='wall')!,map=Buffer.from('synthetic color map'),sha=digest(map),url=`/api/v1/publications/${publicationId}/assets/${assetId}`;
 const material={id:assetId,version:1,kind:'wall',name:'Stone',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Provided by the exhibition editor.',maps:{color:{mime:'image/png',bytes:map.length,sha256:sha,width:2,height:2,colorSpace:'srgb'}}};
 exhibition.extensions={...exhibition.extensions,'org.exhibitos.studio/workspace-materials':{version:1,materials:[material],bindings:[{surfaceId:wall.id,materialId:assetId,materialVersion:1,repeatMeters:[2,2],rotation:0}]}} as never;
 const value={publication:{id:publicationId,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:[{assetId,mime:'image/png',url}]},pub=Buffer.from(JSON.stringify(value)),pubHash=digest(pub),pubPath=`data/${pubHash}.json`;
 const indexFor=(path:string)=>Buffer.from(JSON.stringify({version:1,publication:{path:pubPath,bytes:pub.length,sha256:pubHash,mime:'application/json'},assets:[{assetId,path,bytes:map.length,sha256:sha,mime:'image/png'}]}));
 const install=(index:Buffer)=>{vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+pubPath?pub:path===`/data/${sha}.bin`?map:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));};
 install(indexFor(`data/${sha}.bin`));const accepted=await loadStaticPublication();expect(await (await accepted.local!.fetcher(url)).arrayBuffer()).toEqual(new Uint8Array(map).buffer);
 install(indexFor(`data/${'b'.repeat(64)}.bin`));await expect(loadStaticPublication()).rejects.toThrow('STATIC_WORKSPACE_MATERIAL');
});
