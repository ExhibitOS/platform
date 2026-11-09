// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {Pool} from 'pg';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {prepareProductImage} from './product-image-preparation.ts';
import {LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {FileBlobStore,migrate,sha256,transaction} from '@exhibitos/storage';
import {Cms} from './cms.ts';
import {replaceArtworkReferences} from './artwork-snapshot-replacement.ts';
import type {Session} from './auth.ts';
import {newDraft} from '../../web/src/drafts/example.ts';

it.skipIf(!process.env.PROVENANCE_TEST_PG)('preserves a real CMS-generated revision event through replacement on isolated PostgreSQL',async()=>{
 const pool=new Pool({connectionString:process.env.PROVENANCE_TEST_PG}),tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID(),rightsId=randomUUID(),assetId=randomUUID();
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic credit'},metadata={title:'Synthetic approved',description:'Physical artwork',dimensions:{width:1.2,height:2,depth:.05,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:true,notes:''}},hash='a'.repeat(64);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic artist'}]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,artworkId,artistId,metadata]);await pool.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,artworkId,metadata]);await pool.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,rights]);await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,100,'image/png',1,'approved')",[tenantId,assetId,artworkId,rightsId,`${tenantId}/approved/${hash}`,hash]);await pool.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,1,$3,$4)',[tenantId,artworkId,assetId,{metadata,asset:{id:assetId,mime:'image/png',bytes:100,sha256:hash,rightsRevision:1}}]);await pool.query('UPDATE artworks SET approved_revision=1,approved_asset_id=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId,assetId]);
  const session={tenantId,userId,role:'admin'} as Session,prior=(await transaction(pool,c=>new Cms().studioArtwork(c,session,artworkId))).artwork;expect(prior.provenance.events[0]!.id).toBe(prior.revisionId);
  const next=structuredClone(prior);next.revision++;next.revisionId=randomUUID();next.primaryAssetId=randomUUID();next.assets=[{...next.assets[0]!,id:next.primaryAssetId,path:`assets/${next.primaryAssetId}/image.png`}];next.provenance.events.push({id:next.revisionId,type:'edited',at:new Date().toISOString(),description:'New approval'});
  const scene={...newDraft().candidate,artworks:[prior],placements:[{id:randomUUID(),roomId:randomUUID(),artworkRevisionId:prior.revisionId,assetId:prior.primaryAssetId}]} as unknown as ReturnType<typeof newDraft>['candidate'],result=replaceArtworkReferences(scene,prior,next);
  expect(result.artworks[0]!.provenance.events[0]).toEqual(prior.provenance.events[0]);expect(result.placements[0]).toMatchObject({artworkRevisionId:next.revisionId,assetId:next.primaryAssetId});const live=structuredClone(scene);live.extensions={...live.extensions,unsupported:{assetId:prior.primaryAssetId}};expect(()=>replaceArtworkReferences(live,prior,next)).toThrow('ARTWORK_REPLACEMENT_REFERENCE_UNSUPPORTED');
 }finally{await pool.end();}
},30000);

it.skipIf(!process.env.PROVENANCE_TEST_PG)('rejects staged image outputs and reapproves a committed display after a text edit',async()=>{
 const pool=new Pool({connectionString:process.env.PROVENANCE_TEST_PG});
 const root=await mkdtemp(join(tmpdir(),'exhibitos-image-approval-'));
 const tenantId=randomUUID(),userId=randomUUID(),artistId=randomUUID(),artworkId=randomUUID(),rightsId=randomUUID();
 const session={tenantId,userId,role:'admin'} as Session;
 const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic credit'};
 const metadata:Omit<Parameters<Cms['revise']>[3],'revision'>={title:'Prepared image',description:'',dimensions:{width:1,height:1,unit:'m' as const},rights,provenance:{source:'human-authored' as const,sourceUnits:'m',scaleApplied:true,notes:''}};
 const blobs=new FileBlobStore(root),cms=new Cms(blobs);
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated']);
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:'Synthetic artist'}]);
  await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,artworkId,artistId,metadata]);
  await pool.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,artworkId,metadata]);
  await pool.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,rights]);
  const seedAsset=async(edge:number,background:string)=>{
   const id=randomUUID(),jpeg=await sharp({create:{width:edge,height:edge,channels:3,background}}).jpeg().toBuffer();
   const {full:image}=await prepareProductImage(jpeg,{sha256:sha256(jpeg),bytes:jpeg.length});
   const hash=sha256(image),key=`${tenantId}/approved/${hash}`;
   await blobs.putDurable(key,image);
   await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'image/png',1,'approved')",[tenantId,id,artworkId,rightsId,key,hash,image.length]);
   return {id,sha256:hash,bytes:image.length,mime:'image/png' as const,rightsRevision:1};
  };
  const original=await seedAsset(32,'#172435'),full=await seedAsset(64,'#416173'),coarse=await seedAsset(16,'#416173');
  await transaction(pool,c=>cms.approve(c,session,artworkId,{revision:1,assetId:original.id}));
  const prior=(await transaction(pool,c=>cms.studioArtwork(c,session,artworkId))).artwork;
  await pool.query("INSERT INTO import_jobs(tenant_id,id,user_id,artwork_id,idempotency_key,request_hash,mime,expected_hash,expected_bytes,rights,object_key,approved_key,scale_meters,state,asset_id,derived,derived_object_key,png_drain_version) VALUES($1,$2,$3,$4,$2::uuid::text,$5,'image/jpeg',$5,100,$6,$7,$8,1,'approved',$9,$10,$11,1)",[tenantId,randomUUID(),userId,artworkId,'a'.repeat(64),rights,`${tenantId}/quarantine/original`,`${tenantId}/approved/${full.sha256}`,full.id,{kind:'product-image-pair',result:{coarse:{assetId:coarse.id}}},`${tenantId}/quarantine/prepared`]);
  await transaction(pool,c=>cms.revise(c,session,artworkId,{...metadata,revision:1}));
  for(const candidate of [full,coarse])await expect(transaction(pool,c=>cms.approve(c,session,artworkId,{revision:2,assetId:candidate.id}))).rejects.toMatchObject({code:'ASSET_NOT_APPROVED'});
  // Seed the snapshot produced by a completed replacement. The test targets CMS
  // reapproval and does not claim to exercise the replacement transaction.
  const revisionId=randomUUID(),at=new Date().toISOString();
  const importedArtwork={...prior,revision:2,revisionId,createdAt:at,primaryAssetId:full.id,
   assets:[full,coarse].map(({id,sha256,bytes,mime})=>({id,sha256,bytes,mime,role:'image',path:`assets/${id}/image.png`})),
   provenance:{...prior.provenance,events:[...prior.provenance.events,{id:revisionId,type:'edited',at,description:'Prepared display approved.'}]},
   extensions:{...prior.extensions,'org.exhibitos.studio/cms':{tenantId,artworkId,revision:2},
    [LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',textureSize:64},{assetId:coarse.id,detail:'coarse',textureSize:16}]}}};
  const committedFull={...full,rightsRevision:2};
  await pool.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,2,$3,$4)',[tenantId,artworkId,full.id,{metadata,asset:committedFull,importedArtwork}]);
  await pool.query('UPDATE artworks SET approved_revision=2,approved_asset_id=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,artworkId,full.id]);
  await transaction(pool,c=>cms.revise(c,session,artworkId,{...metadata,title:'Edited title',revision:2}));
  await expect(transaction(pool,c=>cms.approve(c,session,artworkId,{revision:3,assetId:coarse.id}))).rejects.toMatchObject({code:'ASSET_NOT_APPROVED'});
  await transaction(pool,c=>cms.approve(c,session,artworkId,{revision:3,assetId:full.id}));
  const reopened=(await transaction(pool,c=>cms.studioArtwork(c,session,artworkId))).artwork;
  expect(reopened).toMatchObject({revision:3,primaryAssetId:full.id,metadata:{title:'Edited title'}});
  expect(reopened.assets.map(asset=>asset.id)).toEqual([full.id,coarse.id]);
 }finally{
  await pool.end();
  await rm(root,{recursive:true,force:true});
 }
},30000);
