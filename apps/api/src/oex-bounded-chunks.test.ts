// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {FileBlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {createBoundedOexJob,putBoundedOexChunk,verifyBoundedOexChunks,queueBoundedOexJob} from './oex-bounded-chunks.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={tenantId:id(1),userId:id(2),role:'artist'} as Session,job=id(3),key=`${session.tenantId}/oex-staging/${job}/chunk-0`;
const data=Buffer.from('synthetic chunk'),digest=createHash('sha256').update(data).digest('hex');
it('creates one fixed-profile job with exact chunk keys and rejects changed retries',async()=>{
 let prior:unknown,probe='';const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql.includes("set_config('exhibitos.oex_tx_probe'")){probe=args![0] as string;return {rows:[]};}
  if(sql.includes("current_setting('transaction_isolation')"))return {rows:[{isolation:'read committed',probe}]};
  if(sql.includes('WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3'))return {rows:prior?[prior]:[]};
  if(sql.includes('count(*)'))return {rows:[{count:'0',bytes:'0'}]};
  if(sql.startsWith('INSERT')){const keys=JSON.parse(args![6] as string) as string[];expect(keys).toHaveLength(5);expect(keys[0]).toBe(`${session.tenantId}/oex-staging/${args![1]}/chunk-0`);return {rows:[{id:args![1],state:'uploading'}]};}return {rows:[]};
 });const client={query} as unknown as PoolClient,input={requestId:id(5),bytes:64*1024*1024+1,sha256:digest};
 const created=await createBoundedOexJob(client,session,input);expect(created.state).toBe('uploading');
 prior={id:created.id,state:'uploading',archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',payload_sha256:digest,expected_bytes:input.bytes};
 await expect(createBoundedOexJob(client,session,input)).resolves.toEqual(created);await expect(createBoundedOexJob(client,session,{...input,sha256:'0'.repeat(64)})).rejects.toThrow('REQUEST_CONFLICT');
});
it('rejects lost transaction-local state and stronger isolation before quota or insertion',async()=>{
 for(const isolation of ['read committed','repeatable read']){
  let probe='';const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes("set_config('exhibitos.oex_tx_probe'")){probe=args![0] as string;return {rows:[]};}return sql.includes("current_setting('transaction_isolation')")?{rows:[{isolation,probe:isolation==='read committed'?'':probe}]}:{rows:[]};}),client={query} as unknown as PoolClient;
  await expect(createBoundedOexJob(client,session,{requestId:id(5),bytes:1,sha256:digest})).rejects.toThrow('OEX_TRANSACTION_UNSUPPORTED');
  expect(query).toHaveBeenCalledTimes(2);
 }
});
function fixture(){
 const row={tenant_id:session.tenantId,id:job,user_id:session.userId,state:'uploading',expected_bytes:data.length,payload_sha256:digest,archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',staging_keys:[key]};
 let probe='';const client={query:vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.startsWith('UPDATE'))return {rowCount:1,rows:[{id:job,state:'queued'}]};return {rows:[row]};})} as unknown as PoolClient,blobs=new FileBlobStore('/synthetic-unused');const put=vi.spyOn(blobs,'put').mockResolvedValue(),get=vi.spyOn(blobs,'get').mockResolvedValue(data);return {row,client,blobs,put,get};
}
it('stores and verifies the exact authorized immutable chunk',async()=>{
 const f=fixture();await expect(putBoundedOexChunk(f.client,session,job,0,data,f.blobs)).resolves.toEqual({index:0,received:data.length});expect(f.put).toHaveBeenCalledWith(key,data);
 await expect(verifyBoundedOexChunks(f.client,session,job,f.blobs)).resolves.toEqual({bytes:data.length,sha256:digest});
});
it('refuses other users, unsafe namespace, wrong profile and wrong length before writes',async()=>{
 const f=fixture();f.row.user_id=id(4);await expect(putBoundedOexChunk(f.client,session,job,0,data,f.blobs)).rejects.toThrow();f.row.user_id=session.userId;
 f.row.user_id=id(4);await expect(putBoundedOexChunk(f.client,{...session,role:'admin'},job,0,data,f.blobs)).rejects.toThrow();f.row.user_id=session.userId;
 f.row.staging_keys=['other/chunk'];await expect(putBoundedOexChunk(f.client,session,job,0,data,f.blobs)).rejects.toThrow();f.row.staging_keys=[key];
 f.row.archive_profile='wrong';await expect(putBoundedOexChunk(f.client,session,job,0,data,f.blobs)).rejects.toThrow();f.row.archive_profile='bounded-file-v1';
 await expect(putBoundedOexChunk(f.client,session,job,0,Buffer.from('bad'),f.blobs)).rejects.toThrow();expect(f.put).not.toHaveBeenCalled();
});
it('refuses corrupted content and excessive declared length without queuing',async()=>{
 const f=fixture();f.get.mockResolvedValue(Buffer.from('x'.repeat(data.length)));await expect(verifyBoundedOexChunks(f.client,session,job,f.blobs)).rejects.toThrow();
 f.row.expected_bytes=512*1024*1024+1;await expect(verifyBoundedOexChunks(f.client,session,job,f.blobs)).rejects.toThrow();expect(f.client.query).toHaveBeenCalledTimes(6);
});
it('queues only after verifying all uploaded bytes in the same transaction',async()=>{
 const f=fixture();await expect(queueBoundedOexJob(f.client,session,job,f.blobs)).resolves.toEqual({id:job,state:'queued'});expect(f.get).toHaveBeenCalledOnce();
 const corrupt=fixture();corrupt.get.mockResolvedValue(Buffer.from('x'.repeat(data.length)));await expect(queueBoundedOexJob(corrupt.client,session,job,corrupt.blobs)).rejects.toThrow('UPLOAD_INCOMPLETE');
 const query=corrupt.client.query as unknown as ReturnType<typeof vi.fn>;expect(query.mock.calls.some(([sql])=>typeof sql==='string'&&sql.startsWith('UPDATE'))).toBe(false);
});
it('refuses put when transaction-local state is lost',async()=>{
 const query=vi.fn(async(sql:string)=>sql.includes('transaction_isolation')?{rows:[{isolation:'read committed',probe:''}]}:{rows:[]}),blobs=new FileBlobStore('/synthetic-unused'),put=vi.spyOn(blobs,'put').mockResolvedValue();
 await expect(putBoundedOexChunk({query} as unknown as PoolClient,session,job,0,data,blobs)).rejects.toThrow('OEX_TRANSACTION_UNSUPPORTED');expect(put).not.toHaveBeenCalled();
});
it('maps only a missing local chunk to incomplete and preserves other I/O errors',async()=>{
 const f=fixture();f.get.mockRejectedValueOnce(Object.assign(new Error('missing'),{code:'ENOENT'}));await expect(verifyBoundedOexChunks(f.client,session,job,f.blobs)).rejects.toMatchObject({code:'UPLOAD_INCOMPLETE'});
 const error=Object.assign(new Error('I/O'),{code:'EIO'});f.get.mockRejectedValueOnce(error);await expect(verifyBoundedOexChunks(f.client,session,job,f.blobs)).rejects.toBe(error);
});
it('uses the real immutable local store across a 16MiB chunk boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-bounded-chunks-'));
 try{
  const blobs=new FileBlobStore(root),first=Buffer.alloc(16*1024*1024,0x61),second=Buffer.from('tail'),f=fixture();
  f.row.expected_bytes=first.length+second.length;f.row.payload_sha256=createHash('sha256').update(first).update(second).digest('hex');f.row.staging_keys=[key,`${session.tenantId}/oex-staging/${job}/chunk-1`];
  await putBoundedOexChunk(f.client,session,job,0,first,blobs);await putBoundedOexChunk(f.client,session,job,1,second,blobs);
  await expect(putBoundedOexChunk(f.client,session,job,1,Buffer.from('xxxx'),blobs)).rejects.toThrow();
  await expect(verifyBoundedOexChunks(f.client,session,job,blobs)).resolves.toEqual({bytes:first.length+second.length,sha256:f.row.payload_sha256});
 }finally{await rm(root,{recursive:true,force:true});}
},20000);
