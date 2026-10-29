// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {Imports} from './imports.ts';

describe('PNG import physical drain status',()=>{
 it('requires a tracked terminal job without any current or historical owner',()=>{
  const imports=new Imports({} as Pool,{} as BlobStore),base={id:'job',mime:'image/png',state:'cancelled',lease_id:null,png_drain_version:1,png_worker_tokens:[],model_derivation:null,derived:null};
  expect(imports.view(base)).toMatchObject({workerDrainVersion:1,workerDrained:true});
  for(const change of [{state:'processing'},{state:'queued'},{lease_id:'active'},{png_worker_tokens:['old-worker']},{png_drain_version:0},{png_worker_tokens:null}])expect(imports.view({...base,...change}).workerDrained).toBe(false);
  expect(imports.view({...base,png_drain_version:0})).toMatchObject({workerDrainVersion:0,workerDrained:false});
 });
 it('preserves a live owner across repeated cancellation and rejects retry while any invocation remains',async()=>{
  const imports=new Imports({} as Pool,{} as BlobStore),row:Record<string,unknown>={id:'job',mime:'image/png',state:'processing',lease_id:'live',png_drain_version:1,png_worker_tokens:['old','live'],attempts:1,available_at:'2020-01-01T00:00:00Z',model_derivation:null,derived:null};
  vi.spyOn(imports,'access').mockResolvedValue(row);
  const query=vi.fn(async(sql:string)=>{if(sql.startsWith('UPDATE import_jobs')){row.state='cancelled';if(sql.includes('lease_id=NULL'))row.lease_id=null;}return {rows:[row]};}),client={query} as unknown as PoolClient;
  expect((await imports.action(client,{} as Session,'job','cancel')).workerDrained).toBe(false);
  expect((await imports.action(client,{} as Session,'job','cancel')).workerDrained).toBe(false);expect(row.lease_id).toBe('live');
  row.state='failed';await expect(imports.action(client,{} as Session,'job','retry')).rejects.toMatchObject({code:'WORKER_DRAIN_UNCONFIRMED'});
 });
});
