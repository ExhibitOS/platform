// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Artwork} from '@exhibitos/spec';
import {LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {Cms,type ArtworkMetadata} from './cms.ts';
import type {Imports} from './imports.ts';
import {canonicalImageHash,INITIAL_PRODUCT_IMAGE_PURPOSE,type ProductImageReceipt} from './product-image-intent.ts';
import {PRODUCT_IMAGE_PROFILE,PRODUCT_IMAGE_RECIPE,PRODUCT_IMAGE_RECIPE_SHA256} from './product-image-preparation.ts';

vi.mock('./derivative.ts',()=>({derivative:vi.fn(async()=>Buffer.from('synthetic preview'))}));

const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [tenantId,artworkId,artistId,principalId,workspaceId,jobId,originalId,fullId,coarseId]=
  [1,2,3,4,5,6,7,8,9].map(uuid) as [string,string,string,string,string,string,string,string,string];
const session={tenantId,userId:principalId,role:'artist'} as Session;
const originalBytes=Buffer.from('synthetic JPEG original'),fullBytes=Buffer.from('synthetic Full PNG'),coarseBytes=Buffer.from('Coarse PNG');
const metric=(bytes:Buffer,width:number,height:number)=>({sha256:sha256(bytes),bytes:bytes.length,width,height});
const revisionAt='2026-01-02T00:00:00.000Z';

function setup(){
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',
   permissions:{display:true,download:false,export:true,commercial:false}};
 const currentRights={...structuredClone(rights),creditLine:'Reviewed credit'};
 const metadata:ArtworkMetadata={title:'Filename',description:'Synthetic image',dimensions:{width:1,height:1,unit:'m'},rights,
   provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:false,notes:''}};
 const full=metric(fullBytes,1024,1024),coarse=metric(coarseBytes,512,512),source=metric(originalBytes,1024,1024);
 const receiptBody:Omit<ProductImageReceipt,'sha256'>={version:1,jobId,artworkId,artworkRevision:1,workspaceId,principalId,
   rightsSHA256:canonicalImageHash(rights),original:{assetId:originalId,mime:'image/jpeg',sha256:source.sha256,bytes:source.bytes},
   full:{...full,assetId:fullId,mime:'image/png'},coarse:{...coarse,assetId:coarseId,mime:'image/png'},
   producer:{version:1,recipeSHA256:PRODUCT_IMAGE_RECIPE_SHA256,decoder:PRODUCT_IMAGE_RECIPE.decoder,
     source:{...source,mime:'image/jpeg',iccSHA256:null},full,coarse}};
 const receipt={...receiptBody,sha256:canonicalImageHash(receiptBody)};
 const prefix=`${tenantId}/quarantine/import-${jobId}`;
 const job={id:jobId,tenant_id:tenantId,artwork_id:artworkId,user_id:principalId,state:'approved',rights,expected_hash:source.sha256,
   expected_bytes:source.bytes,original_asset_id:originalId,asset_id:fullId,mime:'image/jpeg',
   object_key:`${prefix}/${source.sha256}`,approved_key:`${tenantId}/approved/${full.sha256}`,derived_object_key:`${prefix}/product-full`,
   png_drain_version:1,png_worker_tokens:[],lease_id:null,
   derived:{kind:'product-image-pair',workspaceId,principalId,
     request:{version:1,profile:PRODUCT_IMAGE_PROFILE,purpose:INITIAL_PRODUCT_IMAGE_PURPOSE,artworkRevision:1},result:receipt}};
 const asset=(id:string,mime:string,data:Buffer,object_key:string,state:string)=>
   ({id,mime,sha256:sha256(data),bytes:data.length,object_key,state,scale_meters:1,rights:currentRights,rights_revision:2,product_image_output:true});
 const assets=[asset(originalId,'image/jpeg',originalBytes,job.object_key,'quarantine'),
   asset(fullId,'image/png',fullBytes,job.approved_key,'approved'),asset(coarseId,'image/png',coarseBytes,`${prefix}/product-coarse`,'approved')];
 const artwork:Artwork={schemaVersion:'1.0.0-draft.1',kind:'artwork',id:artworkId,revisionId:uuid(10),revision:1,createdAt:revisionAt,
   metadata:{title:metadata.title,artist:'Synthetic artist',description:metadata.description},artworkType:'image',units:'meter',
   coordinates:'right-handed-y-up',dimensions:{width:1,height:1},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},
   primaryAssetId:fullId,assets:[receipt.full,receipt.coarse!].map(a=>({id:a.assetId,mime:a.mime,sha256:a.sha256,bytes:a.bytes,
     path:`assets/${a.assetId}/image.png`,role:'image'})),rights:structuredClone(rights) as Artwork['rights'],
   provenance:{authorship:'human-authored',events:[{id:uuid(10),type:'edited',at:revisionAt,description:'Initial review'}]},
   extensions:{'org.exhibitos.studio/cms':{tenantId,artworkId,revision:1},
     [LOD_NAMESPACE]:{version:1,variants:[{detail:'full',assetId:fullId,textureSize:1024},{detail:'coarse',assetId:coarseId,textureSize:512}]}}};
 const prior={metadata,asset:{id:fullId,mime:'image/png',bytes:full.bytes,sha256:full.sha256,rightsRevision:1},
   importedArtwork:artwork,freshImagePreparation:receipt.sha256};
 const approvals=new Map([[1,prior]]);
 const article={id:artworkId,artist_id:artistId,revision:2,metadata:{...metadata,title:'Corrected title',rights:currentRights},
   updated_at:revisionAt,approved_revision:null as number|null,approved_asset_id:null as string|null};
 const files=new Map([[job.object_key,originalBytes],[job.approved_key,fullBytes],[`${prefix}/product-coarse`,coarseBytes]]);
 const boundedBlob=vi.fn(async(key:string)=>Buffer.from(files.get(key)!));
 const rows=(values:unknown[])=>({rows:structuredClone(values),rowCount:values.length});
 const query=vi.fn(async(sql:string,p:unknown[])=>{
   if(sql.includes("to_jsonb(j)->>'gpu_preparation'"))return rows([]);
   if(sql.includes("conname='import_model_preparation_shape'"))return rows([{supported:false}]);
   if(sql.startsWith('SELECT * FROM import_jobs')){
     return rows(JSON.stringify(p)===JSON.stringify([job.tenant_id,job.artwork_id,job.user_id,job.asset_id,job.derived.result.sha256])?[job]:[]);
   }
   if(sql.startsWith('SELECT revision,snapshot FROM artwork_approvals')){
     const revision=approvals.has(Number(p[2]))?Number(p[2]):1;
     return rows([{revision,snapshot:approvals.get(revision)}]);
   }
   if(sql.startsWith('SELECT snapshot FROM artwork_approvals'))return rows(approvals.has(Number(p[2]))?[{snapshot:approvals.get(Number(p[2]))}]:[]);
   if(sql.startsWith('SELECT ap.snapshot'))return rows(article.approved_revision===article.revision?[{
     revision:article.revision,snapshot:approvals.get(article.revision),current_metadata:article.metadata,approved_asset_id:article.approved_asset_id}]:[]);
   if(sql.startsWith('SELECT metadata FROM artists'))return rows([{metadata:{name:'Synthetic artist'}}]);
   if(sql.startsWith('SELECT metadata FROM asset_derivatives'))return rows([{metadata:{version:1,kind:'product-image-preparation',serverReceipt:receipt,provenance:'server-generated'}}]);
   if(sql.includes('a.id=ANY'))return rows(assets.filter(a=>(p[2] as string[]).includes(a.id)));
   if(sql.startsWith('SELECT a.*,r.metadata AS rights'))return rows(assets.filter(a=>p[2]===a.id&&a.state==='approved'));
   if(sql.startsWith('INSERT INTO artwork_approvals')){approvals.set(Number(p[2]),structuredClone(p[4]) as typeof prior);return rows([]);}
   if(sql.startsWith('UPDATE artworks SET approved_revision=')){article.approved_revision=Number(p[2]);article.approved_asset_id=String(p[3]);return rows([]);}
   throw new Error(`Unexpected query: ${sql}`);
 });
 const c={query} as unknown as PoolClient,cms=new Cms({get:boundedBlob} as unknown as BlobStore);
 vi.spyOn(cms,'ownArtwork').mockImplementation(async()=>structuredClone(article));
 vi.spyOn(cms,'detail').mockImplementation(async()=>({revision:article.revision,approvedRevision:article.approved_revision}) as Awaited<ReturnType<Cms['detail']>>);
 vi.spyOn(cms,'display').mockResolvedValue({artist:'Synthetic artist'} as Awaited<ReturnType<Cms['display']>>);
 const ready=vi.fn(async()=>{}),coarseOwner=vi.fn(async()=>{});
 const review={ready,imports:()=>({coarseOwner,boundedBlob}) as unknown as Imports};
 const approve=(revision=2,assetId=fullId)=>cms.approve(c,session,artworkId,{revision,assetId},review);
 return {article,approvals,approve,artwork,assets,boundedBlob,c,cms,coarseOwner,files,job,ready,receipt};
}

test('explicit current review preserves original and image pair with one new approval',async()=>{
 const h=setup(),snapshot=structuredClone(h.approvals.get(1)),job=structuredClone(h.job);
 await expect(h.approve()).resolves.toMatchObject({revision:2,approvedRevision:2});
 expect(h.ready).toHaveBeenCalledOnce();
 expect(h.coarseOwner).toHaveBeenCalledWith(h.c,tenantId,principalId,workspaceId);
 expect(h.boundedBlob.mock.calls.map(([key])=>key)).toEqual([...h.files.keys()]);
 const result=(await h.cms.studioArtwork(h.c,session,artworkId)).artwork;
 expect(result.metadata.title).toBe('Corrected title');
 expect(result.rights.creditLine).toBe('Reviewed credit');
 expect(result.assets).toEqual(h.artwork.assets);
 expect(result.extensions?.[LOD_NAMESPACE]).toEqual(h.artwork.extensions?.[LOD_NAMESPACE]);
 expect(result.primaryAssetId).toBe(fullId);
 await h.approve();
 expect(h.approvals.size).toBe(2);
 expect(h.ready).toHaveBeenCalledOnce();
 expect(h.approvals.get(1)).toEqual(snapshot);
 expect(h.job).toEqual(job);
});

test('rejects stale revision, Coarse as primary and a change in rights permissions',async()=>{
 const h=setup();
 await expect(h.approve(1)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 await expect(h.approve(2,coarseId)).rejects.toMatchObject({code:'ASSET_NOT_APPROVED'});
 (h.article.metadata.rights as {permissions:{export:boolean}}).permissions.export=false;
 await expect(h.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 expect(h.ready).not.toHaveBeenCalled();
 expect(h.approvals.has(2)).toBe(false);
});

test('rejects alternate owner, noninitial lineage, and changed Coarse bytes',async()=>{
 const foreign=setup();
 foreign.job.user_id=uuid(99);
 await expect(foreign.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 const wrong=setup();
 Reflect.deleteProperty(wrong.job.derived.request,'purpose');
 await expect(wrong.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 const damaged=setup();
 damaged.files.set(`${tenantId}/quarantine/import-${jobId}/product-coarse`,Buffer.from('changed'));
 await expect(damaged.approve()).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 for(const h of [foreign,wrong,damaged]){
   expect(h.approvals.has(2)).toBe(false);
   expect(h.article.approved_revision).toBeNull();
 }
});

test('requires live local approval authority before rereading the retained lineage',async()=>{
 const h=setup();
 await expect(h.cms.approve(h.c,session,artworkId,{revision:2,assetId:fullId})).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 h.ready.mockRejectedValueOnce(new ApiError(503,'NATIVE_OWNER_UNAVAILABLE'));
 await expect(h.approve()).rejects.toMatchObject({code:'NATIVE_OWNER_UNAVAILABLE'});
 expect(h.coarseOwner).not.toHaveBeenCalled();
 expect(h.boundedBlob).not.toHaveBeenCalled();
 expect(h.approvals.has(2)).toBe(false);
});
