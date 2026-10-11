import {describe,it,expect} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {FileBlobStore,type BlobStore} from '@exhibitos/storage';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OperationalMetrics,observeBlobCapacity} from './operational-metrics.ts';
const id='10000000-0000-4000-8000-000000000001';
const admin={tenantId:id,userId:id,role:'admin'} as Session;
const rows=[{kind:'asset-import',queued:'2',processing:'1',failed24h:'1',oldest_queued_seconds:'301'},{kind:'oex-import',queued:'0',processing:'0',failed24h:'0',oldest_queued_seconds:null}];
function client(role='admin',values=rows){const queries:Array<{sql:string;params?:unknown[]}>=[];return {queries,c:{query:async(sql:string,params?:unknown[])=>{queries.push({sql,params});return {rows:sql.includes('SELECT m.role')?[{role}]:sql.includes('FROM import_jobs')?values:[]};}} as unknown as PoolClient};}
describe('readonly operator metrics',()=>{
 it('requires live administrator membership before storage or queue observation',async()=>{
  const denied=client();await expect(new OperationalMetrics().observe(denied.c,{...admin,role:'artist'})).rejects.toMatchObject({status:403,code:'FORBIDDEN'});expect(denied.queries).toHaveLength(0);
  const changed=client('artist');await expect(new OperationalMetrics().observe(changed.c,admin)).rejects.toMatchObject({status:403,code:'FORBIDDEN'});expect(changed.queries.some(q=>q.sql.includes('FROM import_jobs'))).toBe(false);
 });
 it('uses only the checked tenant and bounded aggregate fields with truthful unsupported measurements',async()=>{
  const f=client(),r=await new OperationalMetrics().observe(f.c,admin);const q=f.queries.find(x=>x.sql.includes('FROM import_jobs'))!;
  expect(q.params).toEqual([id]);expect(q.sql.match(/WHERE tenant_id=\$1/g)).toHaveLength(2);expect(r.queues[0]).toMatchObject({queued:2,processing:1,failed24h:1,oldestQueuedAgeSeconds:301,alert:'warning'});expect(r.queues[1]).toMatchObject({queued:0,oldestQueuedAgeSeconds:null,alert:'normal'});
  expect(r.storage.state).toBe('unknown');expect(r.cpuMemory.state).toBe('unknown');expect(r.databaseCapacity.state).toBe('unknown');expect(r.oexExportQueue.state).toBe('not-applicable');expect(r.errors.failedJobs24h).toBe(1);expect(JSON.stringify(r)).not.toContain(id);expect(JSON.stringify(r)).not.toContain('object_key');expect(r.advisoryOnly).toBe(true);
 });
 it('refuses invalid aggregate bytes instead of inventing a zero or exposing query errors',async()=>{
  for(const patch of [{queued:'9007199254740992'},{failed24h:'-1'},{oldest_queued_seconds:null},{kind:'private-other-table'}]){const f=client('admin',[{...rows[0]!,...patch},rows[1]!]);await expect(new OperationalMetrics().observe(f.c,admin)).rejects.toMatchObject({status:503,code:'OPERATIONAL_OBSERVATION_UNAVAILABLE'});}
  const c={query:async(sql:string)=>{if(sql.includes('SELECT m.role'))return {rows:[{role:'admin'}]};if(sql.includes('FROM import_jobs'))throw Error('synthetic-secret=/private/root');return {rows:[]};}} as unknown as PoolClient;
  await expect(new OperationalMetrics().observe(c,admin)).rejects.toMatchObject({message:'OPERATIONAL_OBSERVATION_UNAVAILABLE'});
 });
 it('observes the actual configured local filesystem and never maps alternate storage to a local directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'exhibitos-operator-metrics-'));try{
   const r=await observeBlobCapacity(new FileBlobStore(root));expect(r.state).toBe('observed');if(r.state==='observed'){expect(r.totalBytes).toBeGreaterThan(0);expect(r.availableBytes).toBeGreaterThanOrEqual(0);expect(r.availableBytes).toBeLessThanOrEqual(r.totalBytes);expect(r.scope).toBe('configured-blob-filesystem-shared-capacity');}expect(JSON.stringify(r)).not.toContain(root);
   const refuse=async()=>{throw Error('must not resolve remote credentials');};const alternate:BlobStore={get:refuse,put:refuse,list:refuse,remove:refuse};expect(await observeBlobCapacity(alternate)).toMatchObject({state:'unknown',reason:'not-local-file-storage'});
   expect(await observeBlobCapacity(new FileBlobStore(join(root,'missing')))).toMatchObject({state:'unknown'});await symlink(root,join(root,'alias'));expect(await observeBlobCapacity(new FileBlobStore(join(root,'alias')))).toMatchObject({state:'unknown'});
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
