// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import sharp from 'sharp';
import {expect,it,vi} from 'vitest';
import {sha256} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {Imports} from './imports.ts';
import {prepareFreshImage} from './product-image-preparation.ts';
import {decodePngPixels} from './png-pixels.ts';
import {assertCurrentImageThumbnail,createCurrentImageThumbnail,currentImageThumbnailView,storedCurrentImageThumbnail,workCurrentImageThumbnail} from './current-image-thumbnail.ts';
const mocks=vi.hoisted(()=>({access:vi.fn(),prepare:vi.fn()}));
vi.mock('@exhibitos/storage',async original=>({...await original<typeof import('@exhibitos/storage')>(),artworkAccess:mocks.access,
 transaction:async(pool:{client:PoolClient},work:(c:PoolClient)=>Promise<unknown>)=>work(pool.client)}));
vi.mock('./product-image-preparation-process.ts',()=>({prepareFreshImageInWorker:mocks.prepare}));
vi.mock('./artwork-thumbnail.ts',()=>({validateThumbnailBytes:async(bytes:Buffer)=>({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)})}));

async function fixture(){
 const tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),artworkId=randomUUID(),sourceId=randomUUID(),requestId=randomUUID(),lease=randomUUID();
 const session={tenantId,userId,role:'admin'} as Session;
 const rights={licenseId:'CC0-1.0',ownership:'owner',holder:'Owner',creditLine:'Owner',permissions:{display:true,export:true,download:true,commercial:true}};
 const bytes=await sharp(Buffer.alloc(40*20*3,93),{raw:{width:40,height:20,channels:3}}).png().toBuffer();
 const fullKey=`${tenantId}/approved/${sha256(bytes)}`,coarseKey=`${tenantId}/approved/existing-coarse`;
 const blobs=new Map([[fullKey,bytes],[coarseKey,Buffer.from('untouched existing coarse')]]);
 const art={id:artworkId,revision:2,approved_revision:2,approved_asset_id:sourceId,metadata:{rights}};
 const source={id:sourceId,sha256:sha256(bytes),bytes:bytes.length,mime:'image/png',rights_id:randomUUID(),rights,object_key:fullKey,state:'approved'};
 const approval={asset:{id:source.id,sha256:source.sha256,bytes:source.bytes,mime:source.mime},metadata:structuredClone(art.metadata)};
 let job:Record<string,unknown>|undefined;
 const assets:Record<string,unknown>[]=[],lineage:unknown[]=[],writes:string[]=[];
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(/^(INSERT|UPDATE|DELETE)/.test(sql))writes.push(sql);
  if(sql.startsWith('SELECT pg_')||sql.startsWith('SELECT id FROM artworks'))return {rows:[],rowCount:0};
  if(sql.includes('SELECT snapshot FROM artwork_approvals'))return {rows:[{snapshot:approval}],rowCount:1};
  if(sql.includes('SELECT a.*,r.metadata AS rights FROM assets'))return {rows:args[2]===sourceId?[source]:[],rowCount:args[2]===sourceId?1:0};
  if(sql.includes('FROM import_jobs WHERE tenant_id=$1 AND idempotency_key=$2'))return {rows:job&&job.idempotency_key===args[1]?[job]:[],rowCount:job?1:0};
  if(sql.startsWith('INSERT INTO import_jobs')){
   job={tenant_id:args[0],id:args[1],user_id:args[2],artwork_id:args[3],idempotency_key:args[4],request_hash:args[5],mime:'image/png',expected_hash:args[6],expected_bytes:args[7],rights:structuredClone(args[8]),object_key:args[9],approved_key:args[9],derived:args[10],derived_object_key:args[11],asset_id:args[12],original_asset_id:null,png_drain_version:1,png_worker_tokens:[],lease_id:null,state:'queued',attempts:0,progress:0};return {rows:[job],rowCount:1};
  }
  if(sql.startsWith('SELECT * FROM import_jobs'))return {rows:job?.state==='processing'&&job.lease_id===args[2]?[job]:[],rowCount:job?.state==='processing'?1:0};
  if(sql.startsWith('INSERT INTO assets')){assets.push({id:args[1],artwork_id:args[2],rights_id:args[3],object_key:args[4],sha256:args[5],bytes:args[6],mime:'image/png'});return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO asset_derivatives')){lineage.push(args[3]);return {rows:[],rowCount:1};}
  if(sql.startsWith("UPDATE import_jobs SET state='approved'")){
   if(!job||job.state!=='processing'||job.lease_id!==args[2])return {rows:[],rowCount:0};
   Object.assign(job,{state:'approved',derived:args[3],lease_id:null,png_worker_tokens:[]});return {rows:[{id:job.id}],rowCount:1};
  }
  if(sql.startsWith('SELECT * FROM assets'))return {rows:assets.filter(a=>a.id===args[2]),rowCount:assets.length};
  if(sql.includes('SELECT metadata FROM asset_derivatives'))return {rows:lineage.map(metadata=>({metadata})),rowCount:lineage.length};
  throw Error('Unexpected SQL: '+sql);
 });
 const c={query} as unknown as PoolClient;
 const writer={writerFd:23,identity:{workspaceId,tenantId,principalId:userId,runtimeGeneration:randomUUID(),rootDevice:'1',rootInode:'2',lockDevice:'1',lockInode:'3'},assertLive:vi.fn(async()=>{})};
 const put=vi.fn(async(key:string,data:Buffer)=>{blobs.set(key,Buffer.from(data));});
 const imports={pool:{client:c},blobs:{putDurable:put},modelExecution:{mode:'native',writer},requiredModelReady:vi.fn(async()=>{}),coarseOwner:vi.fn(async()=>({workspaceId})),boundedBlob:vi.fn(async(key:string)=>Buffer.from(blobs.get(key)!)),view:(row:Record<string,unknown>)=>({id:row.id,state:row.state,thumbnailPreparation:currentImageThumbnailView(row)})} as unknown as Imports;
 mocks.access.mockImplementation(async(_c:unknown,actor:{tenantId:string;userId:string},id:string)=>{if(actor.tenantId!==tenantId||actor.userId!==userId||id!==artworkId)throw Error('FORBIDDEN');return art;});
 mocks.prepare.mockImplementation(async(data:Buffer,identity:{sha256:string;bytes:number;mime:'image/png'})=>({...await prepareFreshImage(data,identity),workerDrained:true,resourceUsage:{peakRssKiB:1,cpuMicros:1}}));
 const create=()=>createCurrentImageThumbnail(imports,c,session,artworkId,{requestId,expectedRevision:2});
 const processing=()=>{const state=storedCurrentImageThumbnail(job!)!;Object.assign(job!,{state:'processing',lease_id:lease,png_worker_tokens:[lease],derived:{...state,claim:{token:lease,...writer.identity}}});return job!;};
 return {imports,c,session,art,source,approval,bytes,blobs,fullKey,coarseKey,requestId,artworkId,lease,put,writer,query,writes,assets,lineage,create,processing,job:()=>job!};
}
it('registers only a reviewable thumbnail from the actual current Full and preserves Full/coarse/revision/scene',async()=>{
 const f=await fixture(),before=structuredClone(f.art),coarse=Buffer.from(f.blobs.get(f.coarseKey)!);
 await f.create();const reader=new Imports(f.imports.pool,f.imports.blobs);expect(reader.view(f.job()).assetId).toBeUndefined();const job=f.processing();await workCurrentImageThumbnail(f.imports,job,f.lease);
 await assertCurrentImageThumbnail(f.imports,f.c,f.session,job);
 expect(f.art).toEqual(before);expect(f.blobs.get(f.fullKey)).toEqual(f.bytes);expect(f.blobs.get(f.coarseKey)).toEqual(coarse);
 expect(f.assets).toHaveLength(1);expect(f.lineage).toHaveLength(1);expect(f.put).toHaveBeenCalledTimes(1);expect(f.put.mock.calls[0]![0]).not.toBe(f.fullKey);
 const view=currentImageThumbnailView(job)!;expect(reader.view(job).assetId).toBe(view.selectionCandidate?.thumbnailAssetId);expect(reader.view(job).assetId).not.toBe(f.source.id);expect(view).toMatchObject({status:'ready',workerDrained:true,source:{assetId:f.source.id,sha256:f.source.sha256},selectionCandidate:{expectedRevision:2,sourceAssetId:f.source.id,view:{kind:'default'}}});
 const png=f.blobs.get(String(job.derived_object_key))!,decoded=decodePngPixels(png);expect(decoded.width).toBeLessThanOrEqual(256);expect(decoded.height).toBeLessThanOrEqual(256);
 expect(f.writes.some(sql=>/artwork_thumbnail_selections|UPDATE artworks|artwork_approvals|studio_exhibitions/.test(sql))).toBe(false);
 expect(mocks.prepare.mock.calls.at(-1)?.[2]).toEqual({writerFd:23});
});
it('replays the same request without another job and rejects caller pixels/source keys',async()=>{
 const f=await fixture(),a=await f.create(),b=await f.create();expect(b.id).toBe(a.id);expect(f.writes.filter(sql=>sql.startsWith('INSERT INTO import_jobs'))).toHaveLength(1);
 await expect(createCurrentImageThumbnail(f.imports,f.c,f.session,f.artworkId,{requestId:f.requestId,expectedRevision:2,pngBase64:'external'})).rejects.toMatchObject({code:'INVALID_INPUT'});
 expect(f.put).not.toHaveBeenCalled();
});
it('does not register a result after revision or rights change during isolated preparation',async()=>{
 for(const change of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.art.revision=3;},(f:Awaited<ReturnType<typeof fixture>>)=>{f.art.metadata.rights.permissions.display=false;}]){
  const f=await fixture();await f.create();const job=f.processing();
  await expect(workCurrentImageThumbnail(f.imports,job,f.lease,{beforeCommit:()=>change(f)})).rejects.toMatchObject({code:expect.stringMatching(/REVISION_CONFLICT|RIGHTS_DENIED/)});
  expect(f.assets).toEqual([]);expect(f.put).not.toHaveBeenCalled();expect(f.blobs.get(f.fullKey)).toEqual(f.bytes);
 }
});
it('rejects corrupt source bytes and retained claims from another worker before producing assets',async()=>{
 const f=await fixture();await f.create();const job=f.processing();f.blobs.set(f.fullKey,Buffer.alloc(f.bytes.length));
 await expect(workCurrentImageThumbnail(f.imports,job,f.lease)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});expect(f.put).not.toHaveBeenCalled();
 const g=await fixture();await g.create();const other=g.processing();
 await expect(workCurrentImageThumbnail(g.imports,other,randomUUID())).rejects.toMatchObject({code:'IMAGE_THUMBNAIL_STATE_INVALID'});expect(g.put).not.toHaveBeenCalled();
});
it('keeps a cancelled lease or undrained ready result out of review/binding readiness',async()=>{
 const f=await fixture();await f.create();const job=f.processing();
 await expect(workCurrentImageThumbnail(f.imports,job,f.lease,{beforeCommit:()=>{job.state='cancelled';}})).rejects.toMatchObject({code:'LEASE_EXPIRED'});expect(f.assets).toEqual([]);expect(f.put).not.toHaveBeenCalled();
 const g=await fixture();await g.create();const ready=g.processing();await workCurrentImageThumbnail(g.imports,ready,g.lease);ready.png_worker_tokens=[randomUUID()];
 const view=currentImageThumbnailView(ready)!;expect(view.workerDrained).toBe(false);expect(view.status).toBe('pending');expect(view).not.toHaveProperty('selectionCandidate');expect(view).not.toHaveProperty('serverReceipt');
});

it('rejects altered persisted request lineage even when source bytes and owner are unchanged',async()=>{
 const f=await fixture();await f.create();const job=f.job();
 job.request_hash='f'.repeat(64);expect(()=>storedCurrentImageThumbnail(job)).toThrowError('IMAGE_THUMBNAIL_STATE_INVALID');
});
