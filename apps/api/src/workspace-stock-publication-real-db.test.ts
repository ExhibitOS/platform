// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {expect, it, vi} from 'vitest';
import {FileBlobStore, migrate, transaction} from '@exhibitos/storage';
import {validateExhibition, type Exhibition} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings, type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
// @ts-expect-error The existing Node-only exporter has no declaration.
import {exportStaticPublication} from '../../../scripts/export-static-publication.mjs';
import {newDraft} from '../../web/src/drafts/example.ts';
import {buildApp} from './app.ts';
import type {Session} from './auth.ts';
import {defaultCatalogueBodyKey, defaultCataloguePersistence} from './default-catalogue-persistence.ts';
import type {PassiveStockRail} from './default-catalogue-passive-rail.ts';
import {admitDefaultCatalogueRelease} from './default-catalogue-release-manifest.ts';
import {createDefaultCatalogueRuntime} from './default-catalogue-runtime.ts';
import {bindNativeLocalExportWorkspace} from './native-oex-provenance.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import hosts from './installed-workspace-hosts.json' with {type:'json'};

vi.mock('../../../scripts/native-workspace-furnishing-admission.mjs',()=>({assertIssuedFurnishingWriterLease:vi.fn()}));

const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const database=process.env.NATIVE_STOCK_PUBLICATION_TEST_PG;
const packaged=process.env.NATIVE_STOCK_PUBLICATION_TEST_PLATFORM;
const fixture=(name:string)=>new URL('./fixtures/rail-v11/'+name,import.meta.resolve('@exhibitos/spec'));

it.skipIf(!database||!packaged)('freezes, serves and exports a pre-existing passive rail save under the real publication foreign key',async()=>{
 const pool=new Pool({connectionString:database});
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-stock-publication-')));
 let app:ReturnType<typeof buildApp>|undefined;
 try{
  const existing=await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1");
  expect(existing.rowCount,'Use an empty disposable PostgreSQL database').toBe(0);
  for(const path of ['migrations','native-oex-normal','native-workspace-furnishing','native-workspace-furnishing-writer','native-workspace-furnishing-publication','native-default-catalogue'])
   await migrate(pool,new URL('../../../database/'+path+'/',import.meta.url).pathname);
  const blobRoot=join(root,'blobs'),workspaceId=randomUUID(),tenantId=randomUUID(),principalId=randomUUID();
  await mkdir(blobRoot,{mode:0o700});
  const blobs=new FileBlobStore(blobRoot),binding={workspaceId,tenantId,principalId};
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Isolated stock publication test']);
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[principalId,randomUUID()]);
  async function auth(userId:string){
   const token=randomBytes(32).toString('base64url'),csrf=randomUUID();
   await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
   await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",
    [randomUUID(),sha(token),sha(csrf),csrf,tenantId,userId]);
   return {host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'exhibitos_local_session='+token,'x-csrf-token':csrf};
  }
  const headers=await auth(principalId),foreignId=randomUUID();
  await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[foreignId,randomUUID()]);
  const foreign=await auth(foreignId);
  await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,principalId,process.getuid!()]);
  const local=await transaction(pool,c=>bindNativeLocalExportWorkspace(c,{...binding,blobRoot,ownerUid:process.getuid!()}));
  const owner={...local,assertCatalog:local.assertDatabase,assertRecord:async()=>{throw Error('Unexpected import');},
   workspaceFurnishingPublication:true,workspaceFurnishingStool:true,workspaceFurnishingRoomVisual:true,
   workspaceFurnishingArtworkFrame:true,workspaceFurnishingArtworkFrameModels:true} as const;
  const baselineMeta=await readFile(join(packaged!,'apps/api/trust/default-catalogue-baseline-v1.json'));
  const baselineManifest=await readFile(join(packaged!,'assets/furnishings/default-manifest.json'));
  const {bundleVersion,sourceCommit}=JSON.parse(baselineMeta.toString());
  const baseline={metadata:baselineMeta,manifest:baselineManifest,tag:'v'+bundleVersion,commit:sourceCommit};
  const seed=admitDefaultCatalogueRelease(baseline.metadata,baseline.manifest,baseline.tag,baseline.commit,()=>true);
  const runtime=createDefaultCatalogueRuntime(binding,blobs,baseline,'1.0.0',file=>readFile(join(packaged!,file.path)),
   ()=>{throw Error('The fixture starts from an already admitted and saved release');});
  const writer={writerFd:-1,identity:{...binding,runtimeGeneration:'test',rootDevice:'1',rootInode:'2',lockDevice:'1',lockInode:'3'},assertLive:async()=>{}};
  const furnishings=new WorkspaceFurnishingIntakes(blobs,owner,writer,runtime);

  const candidate=JSON.parse(await readFile(fixture('exhibition.json'),'utf8')) as Exhibition;
  const graph=candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  const model=await readFile(fixture('linear-track.glb')),notice=Buffer.from('ExhibitOS - CC0-1.0');
  const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',
   permissions:{display:true,export:true,download:true,commercial:true}};
  const rail:PassiveStockRail={
   model:{path:'assets/furnishings/test-rail/model.glb',bytes:model.length,sha256:sha(model)},
   notice:{path:'assets/furnishings/test-rail/LICENSE-NOTICE.txt',bytes:notice.length,sha256:sha(notice)},
   descriptor:{id:randomUUID(),version:1,kind:'ceiling-rail',name:'Test passive rail',provenance:'Verified publisher original.',
    model:{bytes:model.length,sha256:sha(model),mime:'model/gltf-binary'},
    rights,
    fit:{version:1,sourceSha256:sha(model),sourceBytes:model.length,
     geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}},
  };
  const collision={...rail,descriptor:{...rail.descriptor,id:randomUUID()}};
  const benchHost=hosts.find(row=>row.hostKind==='bench')!;
  const bench=benchHost.descriptor as WorkspaceFurnishingDescriptor;
  const benchBytes=await readFile(join(packaged!,benchHost.path));
  expect(sha(benchBytes)).toBe(bench.model.sha256);
  const benchVersion=benchHost.catalogVersion;
  if(benchVersion===undefined)throw Error('Missing installed bench version');
  const retained={...seed,catalogue:{...seed.catalogue,items:seed.catalogue.items.map(item=>
   item.id===benchHost.catalogId?{...item,version:benchVersion}:item)},manifestSha256:sha('fixture previous')};
  const stock={...retained,manifestSha256:sha('fixture active'),catalogue:{...retained.catalogue,
   items:[...retained.catalogue.items,...[rail,collision].map((entry,index)=>({id:'test-rail-'+index,version:1,
    descriptorSha256:sha(JSON.stringify(entry.descriptor)),files:[entry.model,entry.notice],passiveRail:entry}))]}};
  const inCatalogue=<T>(work:(store:ReturnType<typeof defaultCataloguePersistence>)=>Promise<T>)=>
   transaction(pool,c=>work(defaultCataloguePersistence(c,binding,blobs,seed,async()=>undefined)));
  await inCatalogue(async store=>{
   await store.putBody(rail.model,model);
   await store.putBody(rail.notice,notice);
   expect(await store.activate(seed,retained)).toBe(true);
   expect(await store.activate(retained,stock)).toBe(true);
  });

  graph.furnishings=[rail.descriptor,bench];
  graph.placements[0]!.furnishingId=rail.descriptor.id;
  graph.placements.push({id:randomUUID(),roomId:candidate.rooms[0]!.id,furnishingId:bench.id,furnishingVersion:1,
   position:[2,0,0],yaw:0,scale:1});
  const draft=newDraft('Passive rail and stock bench');
  Object.assign(draft.candidate,{rooms:candidate.rooms,surfaces:candidate.surfaces,extensions:candidate.extensions});
  expect(validateExhibition(draft.candidate).errors).toEqual([]);
  const origin='http://127.0.0.1:3000';
  const server=app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'},
   nativeOexWorkspace:owner,nativeExportWorkspace:local,workspaceFurnishing:furnishings,runtimeAvailable:()=>false});
  const studio='/api/v1/tenants/'+tenantId+'/studio/exhibitions';
  async function save(value:typeof draft){
   const response=await server.inject({method:'POST',url:studio,headers,payload:{draft:value,requestId:randomUUID()}});
   expect(response.statusCode,response.body).toBe(201);
   return response.json<{etag:string}>().etag;
  }
  function secondDraft(){
   const copy=structuredClone(draft);
   copy.candidate.id=copy.exhibitionId=randomUUID();
   copy.id=randomUUID();
   return copy;
  }
  const head=await save(draft);
  const publish=(requestId:string,exhibitionId=draft.exhibitionId,etag=head,actor=headers)=>
   server.inject({method:'POST',url:studio+'/'+exhibitionId+'/publications',
    headers:{...actor,'if-match':etag,'x-exhibitos-publication-profile':'bounded-local-v1'},payload:{requestId}});
  const session=await server.inject({url:'/api/v1/auth/session',headers});
  expect(session.statusCode,session.body).toBe(200);
  const forged={...rail.descriptor,rights:{...rights,permissions:{...rights.permissions,export:false}}};
  await expect(transaction(pool,c=>furnishings.bindStockPublicationVersion(c,session.json<Session>(),forged)))
   .rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});
  expect((await pool.query('SELECT id FROM workspace_furnishing_versions')).rows).toEqual([]);
  expect((await publish(randomUUID(),draft.exhibitionId,head,foreign)).statusCode).toBe(403);

  // Fail after the real source FK insert to pin transaction-wide rollback.
  await pool.query(`CREATE FUNCTION test_abort_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture rollback after source binding'; END $$;
    CREATE TRIGGER test_abort_publication BEFORE INSERT ON publication_requests
      FOR EACH ROW EXECUTE FUNCTION test_abort_publication()`);
  const failedRequestId=randomUUID();
  expect((await publish(failedRequestId)).statusCode).toBe(500);
  for(const table of ['studio_publications','publication_workspace_furnishings','workspace_furnishing_versions','publication_requests'])
   expect((await pool.query('SELECT 1 FROM '+table)).rowCount).toBe(0);
  await pool.query('DROP TRIGGER test_abort_publication ON publication_requests');
  // Isolated fixture only: remove the aborted empty-byte stage after checking its exact marker.
  const abortedStage=join(root,'native-publication-'+workspaceId);
  expect(JSON.parse(await readFile(join(abortedStage,'attempt.json'),'utf8')))
   .toMatchObject({requestId:failedRequestId,objects:[]});
  await rm(abortedStage,{recursive:true});

  const requestId=randomUUID(),published=await publish(requestId);
  expect(published.statusCode,published.body).toBe(201);
  expect((await publish(requestId)).json()).toEqual(published.json());
  const {publicationId:id,revisionSha256}=published.json<{publicationId:string;revisionSha256:string}>();
  const rows=(await pool.query('SELECT id,object_key FROM workspace_furnishing_versions')).rows;
  expect(rows).toEqual([{id:rail.descriptor.id,object_key:defaultCatalogueBodyKey(tenantId,rail.model.sha256)}]);
  const publicId=(await pool.query('SELECT public_id FROM publication_workspace_furnishings')).rows[0]?.public_id;
  expect(publicId).toBeTruthy();
  expect(publicId).not.toBe(rail.descriptor.id);

  const library='/api/v1/tenants/'+tenantId+'/workspace/furnishings';
  const listed=await server.inject({url:library,headers});
  expect(listed.statusCode,listed.body).toBe(200);
  expect(listed.json<{items:{id:string;installedCatalog?:true}[]}>().items.filter(item=>item.id===rail.descriptor.id))
   .toEqual([expect.objectContaining({installedCatalog:true})]);
  const retainedDraft=secondDraft(),retainedHead=await save(retainedDraft);
  await inCatalogue(async store=>{
   expect(await store.hasStockIdentityCollision(rail,true)).toBe(false);
   expect(await store.hasStockIdentityCollision(rail,false)).toBe(true);
   expect(await store.activate(stock,retained)).toBe(true);
  });
  const retired=await server.inject({url:library,headers});
  expect(retired.statusCode,retired.body).toBe(200);
  expect(retired.body).not.toContain(rail.descriptor.id);
  const retainedPublication=await publish(randomUUID(),retainedDraft.exhibitionId,retainedHead);
  expect(retainedPublication.statusCode,retainedPublication.body).toBe(201);
  expect((await pool.query('SELECT id,object_key FROM workspace_furnishing_versions')).rows).toEqual(rows);

  const exportRuntime=join(root,'viewer');
  await mkdir(exportRuntime);
  await writeFile(join(exportRuntime,'static.html'),'<html><head><meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256"></head><body></body></html>');
  const output=join(root,'output');
  const receipt=await exportStaticPublication({origin,publicationId:id,runtimeRoot:exportRuntime,output,
   fetcher:async(input:URL)=>{
    const response=await server.inject({url:input.pathname+input.search,headers:{host:input.host}});
    return new Response(Uint8Array.from(response.rawPayload),{status:response.statusCode,headers:response.headers as Record<string,string>});
   }});
  expect(receipt.revisionSha256).toBe(revisionSha256);
  expect(await readFile(join(output,'data',sha(model)+'.bin'))).toEqual(model);
  expect(await readFile(join(output,'data',sha(benchBytes)+'.bin'))).toEqual(benchBytes);

  await inCatalogue(async store=>expect(await store.activate(retained,stock)).toBe(true));
  const other=secondDraft();
  const otherGraph=other.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  otherGraph.furnishings[0]=collision.descriptor;
  otherGraph.placements[0]!.furnishingId=collision.descriptor.id;
  const otherHead=await save(other);
  await pool.query(`INSERT INTO workspace_furnishing_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_key)
    VALUES($1,$2,$3,$4,1,$5,$6)`,[workspaceId,tenantId,principalId,collision.descriptor.id,collision.descriptor,'noncanonical-object-key']);
  await inCatalogue(async store=>expect(await store.hasStockIdentityCollision(collision,true)).toBe(true));
  const failed=await publish(randomUUID(),other.exhibitionId,otherHead);
  expect(failed.statusCode,failed.body).toBe(409);
  expect(failed.json()).toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
  expect((await pool.query('SELECT id FROM studio_publications WHERE exhibition_id=$1',[other.exhibitionId])).rows).toEqual([]);
  await expect(readFile(join(abortedStage,'attempt.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{
  await app?.close();
  await pool.end();
  await rm(root,{recursive:true,force:true});
 }
},30000);
