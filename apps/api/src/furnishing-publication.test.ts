// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {fixtureURL,validateExhibition,revisionHash,type Exhibition} from '@exhibitos/spec';
import {applyBenchCommand,applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry,FURNISHING_NAMESPACE,validateFurnishings} from '@exhibitos/studio-contract';
import {type BlobStore} from '@exhibitos/storage';
import {admittedPublicationFurnishings,projectPublication,Publications} from './publication.ts';
import {buildApp} from './app.ts';

const tenantId=randomUUID(),exhibitionId=randomUUID(),publicationId=randomUUID();
async function fixture(){
 let e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 e.artworks=[];e.placements=[];e.mediaAssets=[];e.annotations=[];e.audioZones=[];e.scripts=[];e.accessibility.artworkDescriptions=[];
 const roomId=e.rooms[0]!.id,id=randomUUID(),viewpointId=randomUUID();
 e=applyBenchCommand(e,{type:'add-bench',bench:{id,name:'Bench',roomId,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,height:.45,depth:.5},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 e=applyFurnishingCommand(e,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}});
 expect(validateExhibition(e).errors).toEqual([]);return e;
}
const emptyStore={get:vi.fn(),put:vi.fn()} as unknown as BlobStore;
const emptyClient={query:vi.fn(async()=>({rows:[],rowCount:0}))} as unknown as PoolClient;
async function prepared(e:Exhibition){return admittedPublicationFurnishings(emptyClient,emptyStore,tenantId,exhibitionId,e);}

it('requires the exact selected catalogue pair before projecting typed remapped public hosts and asset paths',async()=>{
 const source=await fixture(),accepted=await prepared(source),prior=structuredClone(source);
 expect(()=>projectPublication(source,[],new Date().toISOString())).toThrow('PUBLICATION_NOT_READY');
 const {snapshot}=projectPublication(source,[],new Date().toISOString(),[],undefined,accepted),before=furnishingsFor(source)!,after=furnishingsFor(snapshot)!;
 expect(validateFurnishings(snapshot).valid).toBe(true);expect(validateExhibition(snapshot).valid).toBe(true);expect(source).toEqual(prior);
 expect(after.assets[0]!.id).not.toBe(before.assets[0]!.id);expect(after.bindings[0]!.hostId).not.toBe(before.bindings[0]!.hostId);
 expect(after.assets[0]!.path).toBe(`furnishings/${after.assets[0]!.id}/model.glb`);expect(after.assets[0]!.rights.notice.path).toBe(`furnishings/${after.assets[0]!.id}/LICENSE-NOTICE.txt`);
 expect(after.assets[0]!.sha256).toBe(before.assets[0]!.sha256);expect(after.assets[0]!.provenance).toEqual(before.assets[0]!.provenance);
 for(const bytes of ['model','notice'] as const){const broken=accepted.map(p=>({...p,[bytes]:Buffer.from('changed')}));expect(()=>projectPublication(source,[],new Date().toISOString(),[],undefined,broken)).toThrow('PUBLICATION_NOT_READY');}
});
it('rejects unsupported catalogue identity, edited rights and invalid functional hosts before reading source rows',async()=>{
 const e=await fixture();
 for(const change of ['catalog','rights','host']){
  const broken=structuredClone(e),f=furnishingsFor(broken)!;
  if(change==='catalog')f.assets[0]!.catalogId='gallery-stool' as never;
  if(change==='rights')f.assets[0]!.rights.notice.sha256='0'.repeat(64);
  if(change==='host')f.bindings[0]!.pose.position[0]=100;
  broken.extensions![FURNISHING_NAMESPACE]=f as never;const query=vi.fn();
  await expect(admittedPublicationFurnishings({query} as unknown as PoolClient,emptyStore,tenantId,exhibitionId,broken)).rejects.toThrow('FURNISHING_UNAVAILABLE');expect(query).not.toHaveBeenCalled();
 }
});
it('keeps stored imported pairs tenant scoped and fails closed on either corrupt role',async()=>{
 const e=await fixture(),asset=furnishingsFor(e)!.assets[0]!,entry=furnishingCatalogueEntry(asset.catalogId),buffers=await prepared(e);
 for(const affected of ['model','notice'])for(const damage of ['tenant','metadata','bytes','missing-blob']){
  const query=vi.fn(async(_sql:string,args:unknown[])=>{expect(args).toEqual([tenantId,exhibitionId,asset.catalogId,1]);return {rows:['model','notice'].map(role=>({role,resource_path:role==='model'?entry.path:entry.rights.noticePath,bytes:role==='model'?asset.bytes:asset.rights.notice.bytes,sha256:role===affected&&damage==='metadata'?'0'.repeat(64):role==='model'?asset.sha256:asset.rights.notice.sha256,object_key:(role===affected&&damage==='tenant'?randomUUID():tenantId)+'/'+role}))};});
  const get=vi.fn(async(key:string)=>{const affectedKey=key.endsWith('/'+affected);if(affectedKey&&damage==='missing-blob')throw Error('missing');return affectedKey&&damage==='bytes'?Buffer.from('changed'):key.endsWith('/model')?buffers[0]!.model:buffers[0]!.notice;});
  await expect(admittedPublicationFurnishings({query} as unknown as PoolClient,{get} as unknown as BlobStore,tenantId,exhibitionId,e)).rejects.toThrow();
 }
});
it('rejects a persisted half-pair instead of mixing imported and installed resources',async()=>{
 const e=await fixture(),asset=furnishingsFor(e)!.assets[0]!,entry=furnishingCatalogueEntry(asset.catalogId),buffers=await prepared(e);
 const rows=['model','notice'].map(role=>({role,resource_path:role==='model'?entry.path:entry.rights.noticePath,bytes:role==='model'?asset.bytes:asset.rights.notice.bytes,sha256:role==='model'?asset.sha256:asset.rights.notice.sha256,object_key:tenantId+'/'+role}));
 for(const partial of [[rows[0]],[rows[1]],[rows[0],rows[0]]]){
  const query=vi.fn(async()=>({rows:partial})),get=vi.fn();
  await expect(admittedPublicationFurnishings({query} as unknown as PoolClient,{get} as unknown as BlobStore,tenantId,exhibitionId,e)).rejects.toMatchObject({code:'FURNISHING_INTEGRITY'});expect(get).not.toHaveBeenCalled();
 }
 const query=vi.fn(async()=>({rows})),get=vi.fn(async(key:string)=>key.endsWith('/model')?buffers[0]!.model:buffers[0]!.notice);
 expect(await admittedPublicationFurnishings({query} as unknown as PoolClient,{get} as unknown as BlobStore,tenantId,exhibitionId,e)).toEqual(buffers);expect(get).toHaveBeenCalledTimes(2);
});
async function publicFixture(){
 const source=await fixture(),admitted=await prepared(source),snapshot=projectPublication(source,[],new Date().toISOString(),[],undefined,admitted).snapshot;
 const row={id:publicationId,tenant_id:tenantId,exhibition_id:exhibitionId,snapshot,revision_sha256:revisionHash(snapshot),published_at:new Date(),status:'published'};
 const state={live:true,status:'published',corrupt:false};
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('SELECT p.*,s.status'))return {rows:[{...row,status:state.status}],rowCount:1};
  if(sql.includes('SELECT 1 FROM tenants'))return {rows:state.live?[{}]:[],rowCount:state.live?1:0};
  if(sql.includes('studio_furnishing_resources')&&state.corrupt)return {rows:[{resource_path:'changed'}],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const client={query,release:vi.fn()},pool={connect:vi.fn(async()=>client)} as unknown as Pool;
 return {publication:new Publications(pool,emptyStore),row,state,query,asset:furnishingsFor(snapshot)!.assets[0]!,admitted};
}
it('serves only listed public model UUIDs and separate exact notices under shared policy locks',async()=>{
 const {publication,asset,admitted,query}=await publicFixture();
 const metadata=await publication.anonymous(publicationId) as {assets:unknown[];furnishingNotices:unknown[];resources?:unknown};
 expect(metadata.assets).toEqual([{assetId:asset.id,mime:asset.mime,url:`/api/v1/publications/${publicationId}/assets/${asset.id}`}]);
 expect(metadata.furnishingNotices).toEqual([{assetId:asset.id,sha256:asset.rights.notice.sha256,bytes:asset.rights.notice.bytes,mime:'text/plain; charset=utf-8',url:`/api/v1/publications/${publicationId}/furnishing-notices/${asset.id}`}]);expect(metadata.resources).toBeUndefined();
 expect((await publication.anonymous(publicationId,asset.id) as {bytes:Buffer}).bytes).toEqual(admitted[0]!.model);
 expect((await publication.furnishingNotice(publicationId,asset.id)).bytes).toEqual(admitted[0]!.notice);
 await expect(publication.anonymous(publicationId,randomUUID())).rejects.toMatchObject({status:404});await expect(publication.furnishingNotice(publicationId,randomUUID())).rejects.toMatchObject({status:404});
 expect(query.mock.calls.some(([sql])=>sql.includes('pg_advisory_xact_lock_shared(82003)'))).toBe(true);expect(query.mock.calls.some(([sql])=>sql.includes('pg_advisory_xact_lock_shared(82002)'))).toBe(true);
});
it('withdrawal, deleted parents and corrupt current source deny metadata, model and notice together',async()=>{
 for(const reason of ['withdrawn','deleted','source']){
  const {publication,asset,state}=await publicFixture();if(reason==='withdrawn')state.status='unpublished';if(reason==='deleted')state.live=false;if(reason==='source')state.corrupt=true;
  for(const read of [()=>publication.anonymous(publicationId),()=>publication.anonymous(publicationId,asset.id),()=>publication.furnishingNotice(publicationId,asset.id)])await expect(read()).rejects.toMatchObject({status:404,code:'PUBLICATION_UNAVAILABLE'});
 }
});
it('legacy publications omit the optional notice protocol',async()=>{
 const {publication,row}=await publicFixture();delete row.snapshot.extensions![FURNISHING_NAMESPACE];row.revision_sha256=revisionHash(row.snapshot);
 const value=await publication.anonymous(publicationId) as Record<string,unknown>;expect(value.furnishingNotices).toBeUndefined();
});
it('notice HTTP route delegates only to the configured source and never falls back to local DB',async()=>{
 const assetId=randomUUID(),bytes=Buffer.from('exact notice'),furnishingNotice=vi.fn(async()=>({bytes,mime:'text/plain; charset=utf-8',revisionSha256:'a'.repeat(64)}));
 for(const supported of [true,false]){
  const pool={connect:vi.fn(async()=>{throw Error('Local fallback is forbidden');})} as unknown as Pool;
  const source={anonymous:vi.fn(),asset:vi.fn(),...(supported?{furnishingNotice}:{})};
  const app=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},publicationSource:source});
  try{const response=await app.inject({method:'GET',url:`/api/v1/publications/${publicationId}/furnishing-notices/${assetId}`});expect(response.statusCode).toBe(supported?200:404);expect(response.headers['cache-control']).toBe('no-store');if(supported){expect(response.body).toBe(bytes.toString());expect(response.headers['x-exhibitos-publication-revision']).toBe('a'.repeat(64));expect(response.headers['x-content-type-options']).toBe('nosniff');expect(furnishingNotice).toHaveBeenCalledWith(publicationId,assetId);}expect(pool.connect).not.toHaveBeenCalled();}finally{await app.close();}
 }
});
