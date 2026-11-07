// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {Pool,type PoolClient} from 'pg';
import {migrate,transaction,FileBlobStore,Storage,sha256} from '@exhibitos/storage';
import type {Artwork,Lifecycle} from '@exhibitos/spec';
import type {Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {Imports} from './imports.ts';
import {Cms} from './cms.ts';
import {Studio,etag} from './studio.ts';
import {replaceApprovedArtwork} from './artwork-replacement.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

it.skipIf(!process.env.WHEAT_TEST_PG||!process.env.WHEAT_TEST_ROOT||!process.env.EXHIBITOS_WHEAT_SAVED||!process.env.EXHIBITOS_WHEAT_FULL||!process.env.EXHIBITOS_WHEAT_ORIGINAL||!process.env.EXHIBITOS_WHEAT_PROPOSAL)('isolated PostgreSQL worker expiry, protected staging, retry, atomic rollback and replay',async()=>{
 const pool=new Pool({connectionString:process.env.WHEAT_TEST_PG}),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),artistId=randomUUID(),rightsId=randomUUID(),root=process.env.WHEAT_TEST_ROOT!;
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  const data:unknown=JSON.parse(await readFile(process.env.EXHIBITOS_WHEAT_SAVED!,'utf8'));
  const find=(v:unknown):Extract<Lifecycle,{kind:'exhibition-draft'}>|undefined=>{if(!v||typeof v!=='object')return;const o=v as Record<string,unknown>;if(o.kind==='exhibition-draft'&&o.candidate&&typeof o.candidate==='object'&&Array.isArray((o.candidate as {artworks?:unknown}).artworks))return v as Extract<Lifecycle,{kind:'exhibition-draft'}>;for(const x of Object.values(v)){const result=find(x);if(result)return result;}return;};
  const draft=find(data);if(!draft)throw Error('draft missing');const prior=draft.candidate.artworks.find((a:Artwork)=>a.assets.some(x=>x.sha256==='2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f'));if(!prior)throw Error('artwork missing');
  prior.extensions!['org.exhibitos.studio/cms']={tenantId,artworkId:prior.id,revision:prior.revision};
  const metadata={title:prior.metadata.title,description:prior.metadata.description??'',...(prior.metadata.medium?{medium:prior.metadata.medium}:{}),dimensions:{...prior.dimensions,unit:'m'},rights:prior.rights,provenance:{source:prior.provenance.authorship,sourceUnits:'m',scaleApplied:false,notes:''}};
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated test']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query('INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)',[tenantId,artistId,userId,{name:prior.metadata.artist}]);
  await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)',[tenantId,prior.id,artistId,metadata]);
  await pool.query('INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,prior.id,metadata]);await pool.query('INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)',[tenantId,rightsId,prior.rights]);
  for(const a of prior.assets)await pool.query("INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,1,'approved')",[tenantId,a.id,prior.id,rightsId,`${tenantId}/approved/${a.sha256}`,a.sha256,a.bytes,a.mime]);
  const old=prior.assets.find(a=>a.id===prior.primaryAssetId)!;await pool.query('INSERT INTO artwork_approvals(tenant_id,artwork_id,revision,asset_id,snapshot) VALUES($1,$2,1,$3,$4)',[tenantId,prior.id,old.id,{metadata,asset:{id:old.id,sha256:old.sha256,bytes:old.bytes,mime:old.mime,rightsRevision:1},importedArtwork:prior}]);await pool.query('UPDATE artworks SET approved_revision=1,approved_asset_id=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,prior.id,old.id]);
  await pool.query('INSERT INTO exhibitions(tenant_id,id,metadata,studio_managed,studio_owner_user_id) VALUES($1,$2,$3,true,$4)',[tenantId,draft.exhibitionId,draft,userId]);await pool.query('INSERT INTO exhibition_revisions(tenant_id,exhibition_id,revision,snapshot) VALUES($1,$2,1,$3)',[tenantId,draft.exhibitionId,draft]);
  await mkdir(root,{recursive:true,mode:0o700});const blobs=new FileBlobStore(root),owner={tenantId,principalId:userId,workspaceId,assertDatabase:async()=>{}} as unknown as NativeOexWorkspaceContext,session={tenantId,userId,role:'admin'} as Session,imports=new Imports(pool,blobs,owner),cms=new Cms(blobs);
  // Real DB writes and validators; only native bounded-provenance admission is
  // replaced by a test stub. No official owner database or runtime is used.
  const bindAccess=(studio:Studio)=>vi.spyOn(studio,'access').mockImplementation(async(c:PoolClient,_s:Session,id:string)=>{const result=await c.query('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id]);if(!result.rowCount)throw Error('missing exhibition');return {...result.rows[0],nativeBounded:true};});
  const proposal=JSON.parse(await readFile(process.env.EXHIBITOS_WHEAT_PROPOSAL!,'utf8')),original=await readFile(process.env.EXHIBITOS_WHEAT_ORIGINAL!),full=await readFile(process.env.EXHIBITOS_WHEAT_FULL!);
  const input={artworkId:prior.id,idempotencyKey:randomUUID(),mime:'image/jpeg' as const,sha256:sha256(original),bytes:original.length,scaleMeters:1,rights:prior.rights,derived:{mime:'image/png' as const,bytes:full.length,sha256:sha256(full),recipe:proposal.preparation.recipe},coarsePreparation:{version:1 as const,profile:'viewer-png-box-512-v1' as const,approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',artworkRevision:1}};
  const job=await transaction(pool,c=>imports.create(c,session,input));const id=String(job.id);await transaction(pool,async c=>{await imports.upload(c,session,id,original);await imports.uploadDerived(c,session,id,full);await imports.complete(c,session,id);});
  await imports.work({beforeCommit:()=>pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE id=$1",[id]).then(()=>{}),afterCopy:()=>new Promise(resolve=>setTimeout(resolve,250))});
  let status=await transaction(pool,async c=>imports.view(await imports.access(c,session,id)));expect(status.state).toBe('failed');expect(status.errorCode).toBe('LEASE_EXPIRED');expect(status.coarsePreparation?.workerDrained).toBe(true);expect((await pool.query('SELECT count(*) AS n FROM assets WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(String(prior.assets.length));
  const stage=(await pool.query('SELECT derived FROM import_jobs WHERE id=$1',[id])).rows[0].derived.viewerCoarse.stageKey;expect(await new Storage(pool,blobs).reconcile({tenantId,userId},false)).not.toContain(stage);
  await pool.query("UPDATE import_jobs SET available_at=now()-interval '1 second' WHERE id=$1",[id]);await transaction(pool,c=>imports.action(c,session,id,'retry'));await imports.work();status=await transaction(pool,async c=>imports.view(await imports.access(c,session,id)));expect(status.state).toBe('approved');expect(status.coarsePreparation?.workerDrained).toBe(true);
  const cancelJob=await transaction(pool,c=>imports.create(c,session,{...input,idempotencyKey:randomUUID()})),cancelId=String(cancelJob.id);await transaction(pool,async c=>{await imports.upload(c,session,cancelId,original);await imports.uploadDerived(c,session,cancelId,full);await imports.complete(c,session,cancelId);});
  const beforeCancel=(await pool.query('SELECT count(*) AS n FROM assets WHERE tenant_id=$1',[tenantId])).rows[0].n;
  await imports.work({beforeCommit:async()=>{const cancelled=await transaction(pool,c=>imports.action(c,session,cancelId,'cancel'));expect(cancelled.coarsePreparation?.workerDrained).toBe(false);await expect(new Storage(pool,blobs).reconcile({tenantId,userId},true)).rejects.toThrow('import inventory requires review');}});
  const cancelled=await transaction(pool,async c=>imports.view(await imports.access(c,session,cancelId)));expect(cancelled.state).toBe('cancelled');expect(cancelled.coarsePreparation?.workerDrained).toBe(true);expect((await pool.query('SELECT count(*) AS n FROM assets WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(beforeCancel);
  const request={requestId:randomUUID(),artworkId:prior.id,artworkRevision:1,importJobId:id},match=etag(1,draft);
  const missingMaterial=new Studio(owner,true);bindAccess(missingMaterial);
  await expect(transaction(pool,c=>replaceApprovedArtwork(c,session,draft.exhibitionId,request,match,missingMaterial,cms,imports,blobs))).rejects.toThrow('WORKSPACE_MATERIAL_UNAVAILABLE');
  expect((await pool.query('SELECT revision FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,prior.id])).rows[0].revision).toBe(1);
  const binding=draft.candidate.extensions?.['org.exhibitos.studio/workspace-materials'] as {materials:{id:string;version:number}[]};
  const materialService={readVersion:async(_c:PoolClient,_s:Session,materialId:string,version:number)=>{const material=binding.materials.find(m=>m.id===materialId&&m.version===version);if(!material)throw Error('material missing');return structuredClone(material);}} as unknown as WorkspaceMaterialIntakes;
  // The material registry is stubbed; draft validation and every replacement
  // database write, byte read, worker, and receipt are real in this test.
  const studio=new Studio(owner,true,materialService);bindAccess(studio);
  await expect(transaction(pool,async c=>{await replaceApprovedArtwork(c,session,draft.exhibitionId,request,match,studio,cms,imports,blobs);throw Error('forced late rollback');})).rejects.toThrow('forced late rollback');
  expect((await pool.query('SELECT revision,approved_revision FROM artworks WHERE tenant_id=$1 AND id=$2',[tenantId,prior.id])).rows[0]).toMatchObject({revision:1,approved_revision:1});expect((await pool.query('SELECT revision FROM exhibitions WHERE tenant_id=$1 AND id=$2',[tenantId,draft.exhibitionId])).rows[0].revision).toBe(1);
  const response=await transaction(pool,c=>replaceApprovedArtwork(c,session,draft.exhibitionId,request,match,studio,cms,imports,blobs));expect(response.revision).toBe(2);expect(await transaction(pool,c=>replaceApprovedArtwork(c,session,draft.exhibitionId,request,match,studio,cms,imports,blobs))).toEqual(response);expect((await pool.query('SELECT count(*) AS n FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2',[tenantId,prior.id])).rows[0].n).toBe('2');
 }finally{await pool.end();}
},120000);
