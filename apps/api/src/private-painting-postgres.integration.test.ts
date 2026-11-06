// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only via scripts/test-private-painting-postgres.mjs against its own ephemeral DB.
import {randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Pool} from 'pg';
import {migrate,transaction,type BlobStore} from '@exhibitos/storage';
import {bootstrap,type Session} from './auth.ts';
const fixture=vi.hoisted(()=>({approvals:[] as unknown[],decode:vi.fn(async()=>{})}));
vi.mock('./approved-private-painting-imports.ts',()=>({APPROVED_PRIVATE_PAINTING_IMPORTS:fixture.approvals}));
vi.mock('./private-painting-validation.ts',()=>({decodePrivatePaintingPng:fixture.decode}));
import {Imports} from './imports.ts';
const url=process.env.EXHIBITOS_SYNTHETIC_PRIVATE_PG_URL;
const ready=!!url&&process.env.EXHIBITOS_SYNTHETIC_PRIVATE_PG==='1';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const rights={holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:false,export:false,commercial:false},creditLine:'Synthetic'};
describe.skipIf(!ready)('isolated PostgreSQL private painting import',()=>{
 let pool:Pool,imports:Imports,session:Session,tenant:string,artwork:string,files:Map<string,Buffer>,derived:Record<string,unknown>,original:Buffer,png:Buffer;
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||!/^\/private_pg_[a-f0-9]{32}$/.test(parsed.pathname))throw Error('SYNTHETIC_PG_ONLY');
  pool=new Pool({connectionString:url,connectionTimeoutMillis:2000,statement_timeout:5000,max:8});
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  tenant=randomUUID();const actor=await bootstrap(pool,tenant,'private.synthetic.admin','Synthetic-password-12345');session={id:randomUUID(),tenantId:tenant,userId:actor.userId,role:'admin',csrfToken:'',expiresAt:'2099-01-01T00:00:00Z'};
  const artist=randomUUID();artwork=randomUUID();await pool.query("INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}')",[tenant,artist,actor.userId]);await pool.query('INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)',[tenant,artwork,artist,{rights}]);
  files=new Map();const blobs={get:async(k:string)=>{const b=files.get(k);if(!b)throw Error('missing');return Buffer.from(b);},put:async(k:string,b:Uint8Array)=>{files.set(k,Buffer.from(b));},remove:async(k:string)=>{files.delete(k);},list:async()=>[]} as BlobStore;imports=new Imports(pool,blobs);
  original=Buffer.from([255,216,1,2]);png=Buffer.from('synthetic worker is mocked');const colourMeaning='srgb-assumed';
  derived={mime:'image/png',bytes:png.length,sha256:hash(png),recipe:{version:1,role:'baseColor',sampling:'nearest-centre',colourMeaning,recipeSha256:hash(Buffer.from(JSON.stringify({colourMeaning,role:'baseColor',sampling:'nearest-centre',version:1}))),settingsSha256:'a'.repeat(64),sourcePixelsSha256:'b'.repeat(64),outputPixelsSha256:'c'.repeat(64),toolVersion:'synthetic'}};
  fixture.approvals.splice(0,fixture.approvals.length,{tenantId:tenant,artworkId:artwork,revision:1,rights,originalSha256:hash(original),originalBytes:original.length,prepared:structuredClone(derived),profile:'painting-1925x2634',colour:{kind:'no-profile-srgb-assumed'},receiptSha256:'d'.repeat(64)});
 },30000);
 afterAll(async()=>{await pool?.end();});
 async function job(){
  const input={artworkId:artwork,idempotencyKey:randomUUID(),mime:'image/jpeg' as const,sha256:hash(original),bytes:original.length,scaleMeters:1,rights,derived:derived as never};
  const j=await transaction(pool,c=>imports.create(c,session,input)),id=String(j.id);await transaction(pool,c=>imports.upload(c,session,id,original));await transaction(pool,c=>imports.uploadDerived(c,session,id,png));await transaction(pool,c=>imports.complete(c,session,id));return id;
 }
 it('commits the job-owned object and reviewed claim through the actual transaction',async()=>{
  const id=await job();expect(await imports.work()).toBe(true);const r=(await pool.query('SELECT * FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(r.state).toBe('approved');expect(r.png_worker_tokens).toEqual([]);expect(r.approved_key).toBe(r.derived_object_key);
  const asset=(await pool.query('SELECT object_key FROM assets WHERE tenant_id=$1 AND id=$2',[tenant,r.asset_id])).rows[0];expect(asset.object_key).toBe(r.derived_object_key);expect(files.get(asset.object_key)).toEqual(png);
  const provenance=(await pool.query('SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2',[tenant,r.original_asset_id])).rows[0].metadata;expect(provenance.privateAdmission.receiptSha256).toBe('d'.repeat(64));
 });
 it('fences expiry and exhaustion until decoder close and enforces retry limits',async()=>{
  const id=await job();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});fixture.decode.mockImplementationOnce(async()=>{entered();await gate;});
  const running=imports.work();await started;
  try{await pool.query("UPDATE import_jobs SET lease_until=clock_timestamp()-interval '1 second',attempts=5 WHERE tenant_id=$1 AND id=$2",[tenant,id]);expect(await imports.work()).toBe(false);const active=(await pool.query('SELECT state,lease_id,png_worker_tokens FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(active.state).toBe('processing');expect(active.png_worker_tokens).toContain(active.lease_id);}
  finally{release();await running;}
  const stopped=(await pool.query('SELECT state,lease_id,png_worker_tokens,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(stopped.state).toBe('failed');expect(stopped.lease_id).toBeNull();expect(stopped.png_worker_tokens).toEqual([]);expect(stopped.asset_id).toBeNull();await expect(transaction(pool,c=>imports.action(c,session,id,'retry'))).rejects.toMatchObject({code:'JOB_STATE'});
 });
 it('rejects changed revision before asset insertion',async()=>{
  const id=await job();await imports.work({beforeCommit:async()=>{await pool.query('UPDATE artworks SET revision=revision+1 WHERE tenant_id=$1 AND id=$2',[tenant,artwork]);}});const row=(await pool.query('SELECT state,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(row.state).toBe('failed');expect(row.asset_id).toBeNull();await pool.query('UPDATE artworks SET revision=1 WHERE tenant_id=$1 AND id=$2',[tenant,artwork]);
 });
 it('does not hold maintenance lock while waiting for auth lock',async()=>{
  const id=await job(),auth=await pool.connect(),probe=await pool.connect();let running:Promise<boolean>|undefined;
  try{
   await auth.query('SELECT pg_advisory_lock(82003)');running=imports.work();let claimed=false;
   for(let n=0;n<100;n++){const row=(await pool.query('SELECT state FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(row.state==='processing'){claimed=true;break;}await new Promise(r=>setTimeout(r,20));}
   expect(claimed).toBe(true);const available=(await probe.query('SELECT pg_try_advisory_lock(82002) AS acquired')).rows[0].acquired;expect(available).toBe(true);if(available)await probe.query('SELECT pg_advisory_unlock(82002)');
  }finally{await auth.query('SELECT pg_advisory_unlock_all()');auth.release();await probe.query('SELECT pg_advisory_unlock_all()');probe.release();await running;}
 });
 it('preserves cancellation ownership until mocked decoder completion',async()=>{
  const id=await job();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});fixture.decode.mockImplementationOnce(async()=>{entered();await gate;});const running=imports.work();await started;
  try{await transaction(pool,c=>imports.action(c,session,id,'cancel'));const pending=(await pool.query('SELECT state,lease_id,png_worker_tokens FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(pending.state).toBe('cancelled');expect(pending.png_worker_tokens).toContain(pending.lease_id);}
  finally{release();await running;}
  const closed=(await pool.query('SELECT state,lease_id,png_worker_tokens,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(closed.state).toBe('cancelled');expect(closed.lease_id).toBeNull();expect(closed.png_worker_tokens).toEqual([]);expect(closed.asset_id).toBeNull();
 });
 it('refuses revoked display rights without publishing an asset',async()=>{
  const id=await job();try{await imports.work({beforeCommit:async()=>{await pool.query('UPDATE artworks SET metadata=$3 WHERE tenant_id=$1 AND id=$2',[tenant,artwork,{rights:{...rights,permissions:{...rights.permissions,display:false}}}]);}});const row=(await pool.query('SELECT state,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(row.state).toBe('failed');expect(row.asset_id).toBeNull();}finally{await pool.query('UPDATE artworks SET metadata=$3 WHERE tenant_id=$1 AND id=$2',[tenant,artwork,{rights}]);}
 });

 it('rolls back inserted assets if derivative metadata insertion fails',async()=>{
  const id=await job(),before=Number((await pool.query('SELECT count(*) AS n FROM assets WHERE tenant_id=$1',[tenant])).rows[0].n);
  // A permanent function belongs only to the disposable database and enables a
  // separate transaction/client to observe the forced insertion failure.
  await pool.query("CREATE FUNCTION public.synthetic_private_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$");
  await pool.query('CREATE TRIGGER synthetic_private_fail BEFORE INSERT ON asset_derivatives FOR EACH ROW EXECUTE FUNCTION public.synthetic_private_fail()');
  try{await imports.work();const row=(await pool.query('SELECT state,asset_id,derived_object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(row.state).toBe('failed');expect(row.asset_id).toBeNull();expect(Number((await pool.query('SELECT count(*) AS n FROM assets WHERE tenant_id=$1',[tenant])).rows[0].n)).toBe(before);expect(files.get(row.derived_object_key)).toEqual(png);}
  finally{await pool.query('DROP TRIGGER synthetic_private_fail ON asset_derivatives');await pool.query('DROP FUNCTION public.synthetic_private_fail()');}
 });

 it('refuses a changed prepared object before commit',async()=>{
  const id=await job(),key=(await pool.query('SELECT derived_object_key FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0].derived_object_key as string;
  await imports.work({beforeCommit:async()=>{files.set(key,Buffer.from('changed'));}});const row=(await pool.query('SELECT state,asset_id FROM import_jobs WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];expect(row.state).toBe('failed');expect(row.asset_id).toBeNull();
 });

});
