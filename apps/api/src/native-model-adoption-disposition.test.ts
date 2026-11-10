// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import type {Studio,StudioResponse} from './studio.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {disposeNativeModelAdoptionTarget,readNativeModelAdoptionDisposition} from './native-model-adoption-disposition.ts';
import {readNativeModelAdoptionReceipt} from './native-model-adoption-target.ts';

function fixture(){
 const session={tenantId:randomUUID(),userId:randomUUID()} as Session;
 const input={operationId:randomUUID(),grantSha256:'a'.repeat(64),exhibitionId:randomUUID()};
 const receipts=new Map<string,{payload_sha256:unknown;exhibition_id:unknown;response:unknown}>();
 const key=(values:unknown[])=>values.slice(0,3).join(':');
 const query=vi.fn(async(sql:string,values:unknown[])=>{
  if(sql.startsWith('SELECT payload_sha256')){const row=receipts.get(key(values));return {rowCount:row?1:0,rows:row?[row]:[]};}
  if(sql.startsWith('INSERT INTO studio_requests'))receipts.set(key(values),{payload_sha256:values[3],exhibition_id:values[4],response:values[5]});
  return {rowCount:0,rows:[]};
 });
 const c={query} as unknown as PoolClient,access=vi.fn(async()=>({studio_owner_user_id:session.userId}));
 const studio={access} as unknown as Studio;
 return {session,input,c,studio,query,receipts,access};
}
it('persists an idempotent owner-bound terminal fence and distinguishes it from an absent receipt',async()=>{
 const {session:s,input,c,studio,query,access}=fixture();
 expect(await readNativeModelAdoptionDisposition(c,s,input.operationId,input.grantSha256)).toEqual({outcome:'unresolved'});
 expect(await disposeNativeModelAdoptionTarget(c,s,input,studio)).toEqual({outcome:'cancelled'});
 expect(query.mock.calls.find(([sql])=>sql.startsWith('SELECT pg_advisory_xact_lock'))?.[1]).toEqual([`${s.tenantId}:${s.userId}:${input.operationId}`]);
 expect(await disposeNativeModelAdoptionTarget(c,s,input,studio)).toEqual({outcome:'cancelled'});
 expect(access).toHaveBeenCalledTimes(1);
 expect(query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO studio_requests'))).toHaveLength(1);
 await expect(readNativeModelAdoptionReceipt(c,s,input.operationId,input.grantSha256)).rejects.toThrow('MODEL_ADOPTION_CANCELLED');
 for(const changed of [{...input,grantSha256:'b'.repeat(64)},{...input,exhibitionId:randomUUID()}])
  await expect(disposeNativeModelAdoptionTarget(c,s,changed,studio)).rejects.toThrow('REQUEST_CONFLICT');
 expect(await readNativeModelAdoptionDisposition(c,{...s,userId:randomUUID()},input.operationId,input.grantSha256)).toEqual({outcome:'unresolved'});
});
it('never overwrites an existing matching commit and preserves committed replay',async()=>{
 const {session:s,input,c,studio,query,receipts,access}=fixture();
 const response={revision:7,etag:'saved',draft:{}} as StudioResponse;
 receipts.set([s.tenantId,s.userId,input.operationId].join(':'),{payload_sha256:modelReceiptDigest(['native-model-adoption-v1',input.grantSha256]),exhibition_id:input.exhibitionId,response});
 expect(await disposeNativeModelAdoptionTarget(c,s,input,studio)).toEqual({outcome:'committed',response});
 expect(await readNativeModelAdoptionReceipt(c,s,input.operationId,input.grantSha256,input.exhibitionId)).toEqual(response);
 expect(access).not.toHaveBeenCalled();
 expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
});
it('requires current exhibition ownership before creating a terminal record',async()=>{
 const {session:s,input,c,studio,access,receipts}=fixture();
 access.mockResolvedValue({studio_owner_user_id:randomUUID()});
 await expect(disposeNativeModelAdoptionTarget(c,s,input,studio)).rejects.toThrow('FORBIDDEN');
 expect(receipts.size).toBe(0);
});
