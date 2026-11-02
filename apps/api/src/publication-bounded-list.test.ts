// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {fixtureURL,readOex,validateLifecycle} from '@exhibitos/spec';
import {newDraft} from '../../web/src/drafts/example.ts';
import type {Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
import {Publications} from './publication.ts';
import {buildApp} from './app.ts';

it('lists publications for an authenticated bounded import without widening ordinary publication access',async()=>{
 const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),image=source.exhibition.artworks.find(a=>a.artworkType==='image')!,sculpture=source.exhibition.artworks.find(a=>a.artworkType==='sculpture')!;
 const draft=newDraft(),session={id:crypto.randomUUID(),tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session,workspaceId=crypto.randomUUID(),job=crypto.randomUUID(),attempt=crypto.randomUUID(),request=crypto.randomUUID();
 // Same aggregate shape as the isolated 512 MiB witness: one small sculpture,
 // 42 equal-sized images and one smaller image, with no real artwork bytes.
 draft.candidate.artworks=Array.from({length:44},(_,i)=>{const a=structuredClone(i===0?sculpture:image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`synthetic-${i}.${i===0?'glb':'png'}`;a.assets[0]!.bytes=i===0?1516:i===43?8026503:12588868;return a;});
 expect(validateLifecycle(draft).errors).toEqual([expect.objectContaining({code:'ASSET_TOTAL_LIMIT',path:'/candidate/artworks'})]);
 expect(validateLifecycle(draft,undefined,{archiveProfile:'bounded-file-v1'}).valid).toBe(true);
 const provenance={workspace_id:workspaceId,principal_id:session.userId,import_job_id:job,request_id:request,source_sha256:'a'.repeat(64),archive_profile:'bounded-file-v1',source_database_system_id:'42',source_database_oid:'16384',attempt_id:attempt,claim_sha256:'b'.repeat(64),payload_manifest_sha256:'c'.repeat(64),user_id:session.userId,payload_sha256:'a'.repeat(64),job_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',state:'complete',result_exhibition:draft.exhibitionId,workspace_tenant:session.tenantId,workspace_principal:session.userId};
 let verified=true,forged=false;const query=vi.fn(async(sql:string,_args?:unknown[])=>{
  void _args;
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rowCount:1,rows:[{id:draft.exhibitionId,revision:2,metadata:draft,studio_owner_user_id:session.userId}]};
  if(sql.includes('FROM native_oex_exhibition_provenance'))return verified?{rowCount:1,rows:[{...provenance,...(forged?{result_exhibition:crypto.randomUUID()}:{})}]}:{rowCount:0,rows:[]};
  if(sql.startsWith('SELECT p.*,s.status FROM studio_publications'))return {rowCount:0,rows:[]};
  throw Error('unexpected query');
 });
 const client={query} as unknown as PoolClient,context:NativeOexWorkspaceContext={workspaceId,tenantId:session.tenantId,principalId:session.userId,assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}};
 const publisher=new Publications({} as Pool,undefined,context);
 expect(await publisher.listForRead(client,session,draft.exhibitionId)).toEqual({items:[]});
 await expect(publisher.list(client,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 await expect(publisher.studio.access(client,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 verified=false;await expect(publisher.listForRead(client,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 verified=true;forged=true;await expect(publisher.listForRead(client,session,draft.exhibitionId)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
 await expect(new Publications({} as Pool).listForRead(client,session,draft.exhibitionId)).rejects.toMatchObject({code:'DRAFT_CORRUPT'});
 // The federation mutation also consults Publications.list; it must keep the
 // ordinary limit even when the authenticated native read context exists.
 forged=false;const token='a'.repeat(43),csrf='synthetic-csrf',pub=crypto.randomUUID();
 const routeQuery=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.includes('SELECT s.*,m.role'))return {rowCount:1,rows:[{id:session.id,user_id:session.userId,tenant_id:session.tenantId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')}]};
  if(sql.startsWith('SELECT exhibition_id FROM studio_publications'))return {rowCount:1,rows:[{exhibition_id:draft.exhibitionId}]};
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rowCount:0,rows:[]};
  return query(sql,args);
 });
 const routeClient={query:routeQuery,release:()=>{}},pool={connect:async()=>routeClient} as unknown as Pool,key=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString();
 const app=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeOexWorkspace:context,federation:{origin:'https://example.com',privateKey:key}});
 try{
  const headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
  const get=await app.inject({method:'GET',url:`/api/v1/tenants/${session.tenantId}/studio/exhibitions/${draft.exhibitionId}/publications`,headers});expect(get.statusCode).toBe(200);
  const write=await app.inject({method:'POST',url:`/api/v1/tenants/${session.tenantId}/federation/listings/${pub}`,headers,payload:{enabled:true}});expect(write.statusCode).toBe(409);expect(write.json().code).toBe('DRAFT_CORRUPT');
  expect(routeQuery.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE).*federation/i.test(sql))).toBe(false);
 }finally{await app.close();}
});
