// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
import {Cms} from './cms.ts';
import type {Session} from './auth.ts';
import {artworkThumbnailSource} from '../../web/src/native-catalog-protocol.ts';
it.skipIf(!process.env.PROVENANCE_TEST_PG)('retains an approved primary outside the first 100 UUIDs in bounded CMS detail',async()=>{
 const pool=new Pool({connectionString:process.env.PROVENANCE_TEST_PG}),c=await pool.connect();
 const tenantId=randomUUID(),artworkId=randomUUID(),primary='ffffffff-ffff-4fff-8fff-ffffffffffff';
 try{
  await c.query('BEGIN');
  // The temporary relation exercises the real PostgreSQL query, without changing
  // any persistent schema, artwork, credentials or shared workspace.
  await c.query('CREATE TEMP TABLE assets(tenant_id uuid,id uuid,artwork_id uuid,deleted_at timestamptz,mime text,state text,sha256 text,bytes bigint) ON COMMIT DROP');
  await c.query("INSERT INTO assets SELECT $1::uuid,('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$2::uuid,NULL,'image/png','approved',repeat('b',64),100 FROM generate_series(1,105) n",[tenantId,artworkId]);
  await c.query("INSERT INTO assets VALUES($1,$2,$3,NULL,'model/gltf-binary','approved',repeat('a',64),128)",[tenantId,primary,artworkId]);
  expect((await c.query('SELECT id FROM assets WHERE tenant_id=$1 AND artwork_id=$2 ORDER BY id LIMIT 100',[tenantId,artworkId])).rows.some(x=>x.id===primary)).toBe(false);
  const row={id:artworkId,artist_id:randomUUID(),revision:2,approved_revision:2,approved_asset_id:primary,metadata:null,deleted_at:null};
  const cms=new Cms();vi.spyOn(cms,'ownArtwork').mockResolvedValue(row);
  const detail=await cms.detail(c,{tenantId,userId:randomUUID(),role:'admin'} as Session,artworkId);
  expect(detail.assets).toHaveLength(100);expect(detail.assets[0].id).toBe(primary);
  expect(detail.assets.filter(x=>x.id===primary)).toHaveLength(1);
  expect(artworkThumbnailSource(detail,artworkId,2)).toEqual({sourceAssetId:primary,sourceSha256:'a'.repeat(64),sourceBytes:128});
  // Unrelated tenants and artworks cannot displace the admitted primary.
  await c.query("INSERT INTO assets VALUES($1,$2,$3,NULL,'model/gltf-binary','approved',repeat('c',64),256)",[randomUUID(),primary,artworkId]);
  expect((await cms.detail(c,{tenantId} as Session,artworkId)).assets[0]).toMatchObject({id:primary,sha256:'a'.repeat(64),bytes:128});
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
