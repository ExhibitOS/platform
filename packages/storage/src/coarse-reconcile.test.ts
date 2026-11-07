// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
import {Storage} from './index.js';
it('preserves job-scoped staged image bytes and refuses to reconcile while a worker is undrained',async()=>{
 const tenant='tenant',sha='a'.repeat(64),stage=`${tenant}/quarantine/import-job/coarse-${sha}`;
 const job={tenant_id:tenant,id:'job',user_id:'owner',state:'failed',mime:'image/jpeg',png_drain_version:1,png_worker_tokens:[],object_key:`${tenant}/quarantine/import-job/source`,expected_bytes:8,expected_hash:sha,approved_key:`${tenant}/approved/full`,derived_object_key:`${tenant}/quarantine/import-job/prepared`,derived:{mime:'image/png',bytes:8,sha256:sha,viewerCoarse:{intent:{version:1,profile:'viewer-png-box-512-v1',approvalId:'approval',artworkRevision:1},workspaceId:'workspace',principalId:'owner',stageKey:stage,sha256:sha,bytes:6}}};
 const query=vi.fn(async(sql:string)=>{if(sql.includes('SELECT m.role'))return {rows:[{role:'admin'}]};if(sql.includes("to_regclass('import_jobs')"))return {rows:[{name:'import_jobs'}]};if(sql.includes('SELECT * FROM import_jobs'))return {rows:[job]};if(sql.includes('to_regclass'))return {rows:[{name:null}]};return {rows:[]};});
 const orphan=`${tenant}/quarantine/unrelated/orphan`;const client={query,release:()=>{}} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool,remove=vi.fn(),put=vi.fn(),blobs={list:async()=>[stage,orphan],get:async()=>Buffer.from('x'),put,remove} as unknown as BlobStore,storage=new Storage(pool,blobs);
 (job.png_worker_tokens as string[]).push('live');await expect(storage.reconcile({tenantId:tenant,userId:'owner'},true)).rejects.toThrow('import inventory requires review');expect(remove).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 job.png_worker_tokens.length=0;expect(await storage.reconcile({tenantId:tenant,userId:'owner'},true)).toEqual([orphan]);expect(remove).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith(orphan);expect(remove).not.toHaveBeenCalledWith(stage);
});
