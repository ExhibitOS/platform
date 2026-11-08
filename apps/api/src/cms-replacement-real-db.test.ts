// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {Pool} from 'pg';
import {migrate,transaction} from '@exhibitos/storage';
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
