// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {bindNativeDetailContext,OCCUPIED_SELECTED_FINISH_ETAG,OCCUPIED_SELECTED_FINISH_REVISION,OCCUPIED_SELECTED_OUTPUT_REVISION} from './native-detail-context.ts';
import {bindNativeLocalExportWorkspace} from './native-oex-provenance.ts';
import {Studio,etag,type Draft} from './studio.ts';
import * as selection from './native-selected-release.ts';
import {buildApp} from './app.ts';

it('rejects unissued owner and detail context objects before mounting any route',()=>{
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),assertDatabase:async()=>{}};
 expect(()=>bindNativeDetailContext(owner,randomUUID(),new AbortController().signal,()=>true)).toThrow('NATIVE_DETAIL_CONFIGURATION');
 const context={owner,runtimeGeneration:randomUUID(),signal:new AbortController().signal,live:()=>true},pool={} as Pool,auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 expect(()=>buildApp({pool,auth,blobs:new FileBlobStore('/synthetic-unused'),nativeExportWorkspace:owner,nativeDetailContext:context})).toThrow('NATIVE_DETAIL_CONFIGURATION');
});


it.skipIf(!(process.getuid?.())).each([OCCUPIED_SELECTED_OUTPUT_REVISION,OCCUPIED_SELECTED_FINISH_REVISION])(
 'requires an occupied pin for authenticated r%i and original services before issuing its route',async(revision)=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-selected-head-')));
 const workspaceId=randomUUID(),tenantId=randomUUID(),userId=randomUUID(),exhibitionId=randomUUID();
 const csrf='test-csrf',token='a'.repeat(43);
 const session={id:randomUUID(),tenant_id:tenantId,user_id:userId,role:'admin',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{
  if(sql.includes('pg_control_system()'))return {rows:[{system_id:'1',database_oid:'2'}],rowCount:1};
  if(sql.includes('FROM local_workspaces'))return {rows:[{bound:true}],rowCount:1};
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  return {rows:[],rowCount:0};
 },release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const draft={id:exhibitionId,exhibitionId} as Draft,match=etag(revision,draft);
 const access=vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision,metadata:draft,studio_owner_user_id:userId,nativeBounded:true});
 const selector=vi.spyOn(selection,'loadSelectedNativeRelease');
 let app:ReturnType<typeof buildApp>|undefined;
 try{
  const nativeExportWorkspace=await bindNativeLocalExportWorkspace(client as unknown as PoolClient,{workspaceId,tenantId,principalId:userId,ownerUid:process.getuid!(),blobRoot:root});
  const signal=new AbortController().signal, runtimeGeneration=randomUUID();
  const common={pool,auth,blobs:new FileBlobStore(root),nativeExportWorkspace};
  const finish=revision===OCCUPIED_SELECTED_FINISH_REVISION;
  if(finish)expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,{revision,etag:match})).toThrow('NATIVE_DETAIL_CONFIGURATION');
  const pinned=bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,{revision,etag:finish?OCCUPIED_SELECTED_FINISH_ETAG:match});
  expect(()=>buildApp({...common,nativeDetailContext:pinned})).toThrow('NATIVE_DETAIL_CONFIGURATION');

  const nativeOexWorkspace={workspaceId,tenantId,principalId:userId,assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}};
  app=buildApp({...common,nativeOexWorkspace,nativeDetailContext:bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true)});
  const response=await app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${exhibitionId}/publications`,
   headers:{host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match,'x-exhibitos-publication-profile':'native-original-v1'},
   payload:{requestId:randomUUID(),releaseSelection:selection.SELECTED_NATIVE_RELEASE,originalImage:{artworkId:randomUUID(),artworkRevision:1,importJobId:randomUUID()}}});
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({code:'NATIVE_DETAIL_UNAVAILABLE'});
  expect(access).toHaveBeenCalledOnce();
  expect(selector).not.toHaveBeenCalled();
 }finally{
  try{await app?.close();}finally{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});}
 }
});
