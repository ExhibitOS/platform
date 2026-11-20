// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {CLOSING_LIGHTS_SELECTED_SCOPE,PAINTING_BENCH_SELECTED_SCOPE,RETAINED_SPOTS_SELECTED_SCOPE,selectedScopeRequiresWheatNotice,WHEAT_IMAGE_FIT_SELECTED_SCOPE,WHEAT_SELECTED_SCOPE} from '@exhibitos/studio-contract';
import {revisionHash,type Exhibition} from '@exhibitos/spec';
import {Cms} from './cms.ts';
import {Imports} from './imports.ts';
import {reconstructNativeOriginalExport} from './native-original-export-plan.ts';
import {ACCEPTED_CLOSING_PREDECESSOR,ACCEPTED_WHEAT_FIT_PREDECESSOR,ACCEPTED_WHEAT_PREDECESSOR,bindNativeDetailContext,OCCUPIED_PAINTING_BENCH_ETAG,OCCUPIED_PAINTING_BENCH_REVISION,OCCUPIED_CANNON_SCOPE,OCCUPIED_PUBLIC_FINISH_SCOPE,OCCUPIED_POST_WHEAT_ETAG,OCCUPIED_POST_WHEAT_REVISION,OCCUPIED_SELECTED_FINISH_ETAG,OCCUPIED_SELECTED_FINISH_REVISION,OCCUPIED_SELECTED_OUTPUT_REVISION,WHEAT_IMAGE_FIT_SUCCESSOR_REVISION} from './native-detail-context.ts';
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
  const cannon={revision:OCCUPIED_SELECTED_FINISH_REVISION,etag:OCCUPIED_SELECTED_FINISH_ETAG,
   scope:OCCUPIED_CANNON_SCOPE,projectionIdentity:`v1:${'a'.repeat(64)}`};
  if(finish){
   const scoped=bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,cannon);
   expect(scoped.selectedHead).toEqual(cannon);
   expect(Object.isFrozen(scoped.selectedHead)).toBe(true);
   const publicFinishes={...cannon,scope:OCCUPIED_PUBLIC_FINISH_SCOPE};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,publicFinishes).selectedHead).toEqual(publicFinishes);
   const postWheat={revision:OCCUPIED_POST_WHEAT_REVISION,etag:OCCUPIED_POST_WHEAT_ETAG};
   for(const scope of [OCCUPIED_PUBLIC_FINISH_SCOPE,OCCUPIED_CANNON_SCOPE]){
    const marker={...postWheat,scope,projectionIdentity:cannon.projectionIdentity};
    expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,marker).selectedHead).toEqual(marker);
   }
   expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,postWheat)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   const wheat={...postWheat,scope:WHEAT_SELECTED_SCOPE,projectionIdentity:cannon.projectionIdentity,
    predecessorPublicationId:randomUUID(),predecessorRevisionSha256:'f'.repeat(64)};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,wheat).selectedHead).toEqual(wheat);
   for(const invalid of [{...wheat,predecessorPublicationId:undefined},{...wheat,predecessorRevisionSha256:'bad'},
    {...wheat,revision:OCCUPIED_SELECTED_FINISH_REVISION,etag:OCCUPIED_SELECTED_FINISH_ETAG},
    {...wheat,scope:OCCUPIED_PUBLIC_FINISH_SCOPE}]){
    expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   }
   const paintingBench={revision:OCCUPIED_PAINTING_BENCH_REVISION,etag:OCCUPIED_PAINTING_BENCH_ETAG,
    scope:PAINTING_BENCH_SELECTED_SCOPE,projectionIdentity:cannon.projectionIdentity,
    predecessorPublicationId:ACCEPTED_WHEAT_PREDECESSOR.publicationId,predecessorRevisionSha256:ACCEPTED_WHEAT_PREDECESSOR.revisionSha256};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,paintingBench).selectedHead).toEqual(paintingBench);
   expect(selectedScopeRequiresWheatNotice(paintingBench.scope)).toBe(true);
   expect(selectedScopeRequiresWheatNotice(publicFinishes.scope)).toBe(false);
   for(const invalid of [{...paintingBench,revision:217},{...paintingBench,etag:wheat.etag},
    {...paintingBench,predecessorPublicationId:wheat.predecessorPublicationId},{...paintingBench,predecessorRevisionSha256:'f'.repeat(64)},
    {...paintingBench,scope:WHEAT_SELECTED_SCOPE},{...paintingBench,extra:true}]){
    expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   }
   const repair={...paintingBench,scope:WHEAT_IMAGE_FIT_SELECTED_SCOPE,revision:WHEAT_IMAGE_FIT_SUCCESSOR_REVISION,
    etag:`"studio-r${WHEAT_IMAGE_FIT_SUCCESSOR_REVISION}-${'1'.repeat(64)}"`};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,repair).selectedHead).toEqual(repair);
   expect(selectedScopeRequiresWheatNotice(repair.scope)).toBe(true);
   for(const invalid of [{...repair,revision:repair.revision+1},{...repair,etag:paintingBench.etag},
    {...repair,predecessorPublicationId:wheat.predecessorPublicationId},{...repair,scope:paintingBench.scope},
    {...repair,predecessorRevisionSha256:'0'.repeat(64)}]){
    expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   }
   const acceptedFit=ACCEPTED_WHEAT_FIT_PREDECESSOR;
   const closing={...repair,scope:CLOSING_LIGHTS_SELECTED_SCOPE,etag:acceptedFit.etag,
    predecessorPublicationId:acceptedFit.publicationId,predecessorRevisionSha256:acceptedFit.revisionSha256};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,closing).selectedHead).toEqual(closing);
   expect(selectedScopeRequiresWheatNotice(closing.scope)).toBe(true);
   for(const invalid of [{...closing,revision:closing.revision+1},{...closing,etag:repair.etag},
    {...closing,predecessorPublicationId:repair.predecessorPublicationId},
    {...closing,predecessorRevisionSha256:repair.predecessorRevisionSha256},
    {...closing,scope:repair.scope},{...closing,includePainting:true}]){
    expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   }
   const deployedClosing=ACCEPTED_CLOSING_PREDECESSOR;
   const retained={...closing,scope:RETAINED_SPOTS_SELECTED_SCOPE,
    predecessorPublicationId:deployedClosing.publicationId,predecessorRevisionSha256:deployedClosing.revisionSha256};
   expect(bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,retained).selectedHead).toEqual(retained);
   expect(selectedScopeRequiresWheatNotice(retained.scope)).toBe(true);
   for(const invalid of [{...retained,predecessorPublicationId:acceptedFit.publicationId},
    {...retained,predecessorRevisionSha256:acceptedFit.revisionSha256},{...retained,etag:repair.etag}]){
    expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
   }
   expect(()=>buildApp({...common,nativeDetailContext:scoped})).toThrow('NATIVE_DETAIL_CONFIGURATION');
   for(const invalid of [
    {...cannon,revision:OCCUPIED_SELECTED_OUTPUT_REVISION}, {...cannon,etag:match},
    {...cannon,scope:'transition-two-spots-v1'}, {...cannon,projectionIdentity:undefined},
    {...publicFinishes,scope:'seven-visual-finishes-v1'}, {...publicFinishes,revision:217},
    {...cannon,projectionIdentity:'v1:bad'}, {...cannon,allowHayes:true},
   ])expect(()=>bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,invalid)).toThrow('NATIVE_DETAIL_CONFIGURATION');
  }


  const nativeOexWorkspace={workspaceId,tenantId,principalId:userId,assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}};
  if(finish){
   const context=bindNativeDetailContext(nativeExportWorkspace,runtimeGeneration,signal,()=>true,cannon);
   const snapshot={artworks:[]} as unknown as Exhibition;
   const revisionSha256=revisionHash(snapshot),publicationId=randomUUID();
   const ownerSession={id:session.id,userId,tenantId,role:'admin' as const,csrfToken:csrf,expiresAt:session.expires_at.toISOString()};
   const deps={context,studio:new Studio(),cms:new Cms(common.blobs),imports:new Imports(pool,common.blobs,nativeOexWorkspace),blobs:common.blobs};
   const reads=vi.fn(async(sql:string,args:unknown[])=>{
    if(sql.includes('SHOW transaction_isolation'))return {rows:[{transaction_isolation:'read committed'}]};
    if(sql.includes('FROM studio_publications p'))return {rows:[{exhibition_id:exhibitionId,studio_owner_user_id:userId,status:'published',snapshot,revision_sha256:revisionSha256}]};
    if(sql.includes('FROM studio_requests r')){
     expect(sql).toContain("r.response->>'projectionIdentity'=$7");
     expect(args).toEqual([tenantId,userId,publicationId,revision,selection.SELECTED_NATIVE_RELEASE,cannon.etag,cannon.projectionIdentity]);
     return {rows:[]};
    }
    expect(sql).not.toContain('FROM publication_assets');
    return client.query(sql);
   });
   await expect(reconstructNativeOriginalExport({query:reads} as unknown as PoolClient,ownerSession,publicationId,revisionSha256,deps,signal)).rejects.toThrow('NATIVE_DETAIL_UNAVAILABLE');
   expect(reads.mock.calls.some(([sql])=>sql.includes('FROM studio_requests r'))).toBe(true);
  }
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
