// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic API/SQL/output boundary proof, never a rendered-space or GUI claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {fixtureURL,readOex,writeOex} from '@exhibitos/spec';
import {spaceStillFor} from '@exhibitos/spec/space-still';
import {MATERIAL_NAMESPACE as N,surfaceTextureDefaults,verifyFreezeBundle} from '@exhibitos/studio-contract';
import {OEX_SURFACE_MATERIAL_VERSION,packageSurfaceMaterialManifest,SURFACE_MATERIAL_PACKS,surfaceMaterialNotice} from '@exhibitos/spec/surface-material-resources';
import {migrate,FileBlobStore,sha256,transaction,collectServiceInventory,inventoryCanonical} from '../packages/storage/dist/index.js';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Oex} from '../apps/api/dist/oex.js';
import {Privacy} from '../apps/api/dist/privacy.js';
import {exportStaticPublication} from './export-static-publication.mjs';
const database=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(database.hostname!=='127.0.0.1'||!database.pathname.startsWith('/exhibitos_native_session_test_')||!process.env.EXHIBITOS_TEST_OUTPUT)throw Error('ISOLATED_SURFACE_RESOURCE_FIXTURE_REQUIRED');
const output=resolve(process.env.EXHIBITOS_TEST_OUTPUT),pool=new Pool({connectionString:database.href,max:4,statement_timeout:10000});
await mkdir(output,{recursive:true,mode:0o700});
const workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const origin='http://127.0.0.1:3000',headers={host:'127.0.0.1:3000',origin,cookie:`exhibitos_local_session=${workspace.sessionToken}`,'x-csrf-token':workspace.csrfToken};
const keys=generateKeyPairSync('ed25519');
let app;
try{
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);await openLocalWorkspace(pool,workspace,'native');
 const blobs=new FileBlobStore(join(output,'blobs'));app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'},freeze:{runtimeRoot:resolve('apps/web/dist'),signingKey:keys.privateKey,origin}});const worker=new Oex(pool,blobs),prefix=`/api/v1/tenants/${workspace.tenantId}`;
 const request=(method,path,payload,extra={})=>app.inject({method,url:prefix+path,headers:{...headers,...(Buffer.isBuffer(payload)?{'content-type':'application/octet-stream'}:{}),...extra},...(payload===undefined?{}:{payload})});
 const expected=async(promise,status)=>{const response=await promise;let code='';if(response.statusCode!==status){try{code=response.json().code??'';}catch{/* Non-JSON error bodies still report their actual HTTP status. */}}assert.equal(response.statusCode,status,'HTTP boundary '+code);return response;};
 const json=async(promise,status=200)=>(await expected(promise,status)).json();
 const imported=async bytes=>{
  const job=await json(request('POST','/oex/imports',{requestId:randomUUID(),bytes:bytes.length,sha256:sha256(bytes)}),201);await expected(request('PUT',`/oex/imports/${job.id}/bytes`,bytes),200);await expected(request('POST',`/oex/imports/${job.id}/complete`,{}),200);await worker.run(job.id);
  const result=await json(request('GET',`/oex/imports/${job.id}`));assert.equal(result.state,'complete','OEX worker did not complete: '+result.errorCode);return result.result;
 };
 await test('selected wall and ceiling maps survive protected import, save/reopen, OEX, static and signed freeze output',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-space-still.oex'))),e=structuredClone(original.exhibition);
  const wall=e.surfaces.find(s=>s.type==='wall'),room=e.rooms.find(r=>r.id===wall.roomId),ceiling=structuredClone(wall);ceiling.id=randomUUID();ceiling.type='ceiling';ceiling.dimensions={width:room.dimensions.width,height:room.dimensions.depth};ceiling.transform={position:[0,room.dimensions.height,0],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]};e.surfaces.push(ceiling);
  const paint=surfaceTextureDefaults('museum-matte-paint').texture,plaster={...surfaceTextureDefaults('fine-lime-plaster').texture,rotation:.2,normalScale:.6};
  e.extensions={...e.extensions,[N]:{version:1,surfaces:{[wall.id]:{color:'#abcdef',roughness:.41,metalness:.1}},surfaceTextures:{[wall.id]:paint,[ceiling.id]:plaster}}};
  const catalogue=await json(request('GET','/studio/materials'));assert.equal(catalogue.version,1);assert.equal(catalogue.items.length,2);assert(catalogue.items.every(item=>item.preview===null));
  await expected(app.inject({method:'GET',url:prefix+'/studio/materials',headers:{host:headers.host}}),401);
  await expected(request('GET','/studio/materials/museum-matte-paint/1/preview'),404);
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)]));
  const expectedResources=packageSurfaceMaterialManifest(e);
  for(const resource of expectedResources){
   if(resource.role==='notice'){files.set(resource.artifactPath,Buffer.from(surfaceMaterialNotice(SURFACE_MATERIAL_PACKS.find(p=>p.id===resource.packId))));}
   else files.set(resource.artifactPath,await readFile(new URL('../apps/web/public/'+resource.artifactPath,import.meta.url)));
  }
  const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),base=await imported(archive),id=base.exhibitionId;
  assert.notEqual(id,e.id);const mapped=base.draft.candidate.extensions[N];assert.deepEqual(mapped.surfaceTextures[base.idMap[wall.id.toLowerCase()]],paint);assert.deepEqual(mapped.surfaceTextures[base.idMap[ceiling.id.toLowerCase()]],plaster);assert.deepEqual(mapped.surfaces[base.idMap[wall.id.toLowerCase()]],e.extensions[N].surfaces[wall.id]);assert.equal(mapped.surfaceTextures[wall.id],undefined);
  const rows=(await pool.query('SELECT * FROM studio_surface_material_resources WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY resource_path',[workspace.tenantId,id])).rows;assert.equal(rows.length,8);
  for(const row of rows){const resource=expectedResources.find(f=>f.artifactPath===row.resource_path);assert(resource);const bytes=await blobs.get(row.object_key);assert.equal(sha256(bytes),resource.sha256);assert.deepEqual(Buffer.from(bytes),files.get(resource.artifactPath));}
  await assert.rejects(pool.query('UPDATE studio_surface_material_resources SET sha256=$3 WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,id,'0'.repeat(64)]));
  const draft=structuredClone(base.draft);draft.editVersion++;draft.updatedAt=new Date().toISOString();draft.candidate.title='Synthetic portable wall material proof';
  const saved=await json(request('PUT',`/studio/exhibitions/${id}`,{requestId:randomUUID(),draft},{'if-match':base.etag})),reopened=await json(request('GET',`/studio/exhibitions/${id}`));assert.deepEqual(reopened.draft,saved.draft);
  const exported=await expected(request('POST',`/studio/exhibitions/${id}/oex/export`,{},{'if-match':saved.etag}),200),roundtrip=await readOex(exported.rawPayload);assert.equal(roundtrip.manifest.formatVersion,OEX_SURFACE_MATERIAL_VERSION);
  assert.deepEqual(roundtrip.manifest.materialResources,expectedResources);for(const resource of expectedResources)assert.deepEqual(roundtrip.files.get(resource.path),files.get(resource.artifactPath));
  assert.equal(spaceStillFor(roundtrip.exhibition).sha256,spaceStillFor(e).sha256);
  const restored=await imported(exported.rawPayload);assert.notEqual(restored.exhibitionId,id);assert.equal((await pool.query('SELECT count(*)::int AS count FROM studio_surface_material_resources WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,restored.exhibitionId])).rows[0].count,8);
  const inventory=await transaction(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(82002)');
   const report=await collectServiceInventory(c,blobs,{migrationDirectory:resolve('database/migrations')});assert.deepEqual(report.issues,[]);assert.match(report.schemaDigest,/^[a-f0-9]{64}$/);
   assert(report.migrations.some(m=>m.name==='016_local_workspaces.sql'));assert(report.migrations.some(m=>m.name==='017_cover_images.sql'));assert(report.migrations.some(m=>m.name==='020_surface_material_resources.sql'));
   assert.equal(report.tables.find(t=>t.name==='studio_surface_material_resources').rowCount,16);
   for(const row of rows){assert(report.references.some(r=>r.key===row.object_key&&r.required&&r.expectedSha256===row.sha256));assert.equal(await new Privacy(pool,blobs).referenced(c,row.object_key),true);}
   const oldCatalog=report.migrations.filter(m=>m.name!=='020_surface_material_resources.sql'),oldTarget=await collectServiceInventory(c,blobs,{migrationCatalog:oldCatalog});assert(oldTarget.issues.some(i=>i.code==='MIGRATION_UNKNOWN'&&i.binding==='020_surface_material_resources.sql'));
   return report;
  });
  const catalog={schemaVersion:inventory.schemaVersion,schemaDigest:inventory.schemaDigest,migrations:inventory.migrations};
  await writeFile(join(output,'surface-material-runtime-schema-observation.json'),JSON.stringify({...catalog,targetSchemaSha256:sha256(Buffer.from(inventoryCanonical(catalog))),source:'Actual isolated SQL/imported-resource inventory, not a signed native runtime',artifactAuthenticated:false,compatibilityQualified:false,updateExecuted:false},null,2));
  const publication=await json(request('POST',`/studio/exhibitions/${id}/publications`,{requestId:randomUUID()},{'if-match':saved.etag}),201);
  const fetcher=async input=>{const url=new URL(input),result=await app.inject({method:'GET',url:url.pathname+url.search,headers:{host:headers.host}});return new Response(new Uint8Array(result.rawPayload),{status:result.statusCode,headers:result.headers});};
  const result=await exportStaticPublication({origin,publicationId:publication.publicationId,runtimeRoot:resolve('apps/web/dist-static'),output:join(output,'static-surface-materials'),fetcher});
  const manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json'),'utf8'));assert.deepEqual(manifest.files.filter(f=>f.path.startsWith('surface-material-')).map(f=>f.path).sort(),expectedResources.map(f=>f.artifactPath).sort());
  for(const resource of expectedResources)assert.deepEqual(await readFile(join(result.output,resource.artifactPath)),files.get(resource.artifactPath));
  const frozen=await json(request('POST',`/studio/exhibitions/${id}/freezes`,{requestId:randomUUID()},{'if-match':saved.etag}),201);
  assert.equal(frozen.manifest.formats.oex,OEX_SURFACE_MATERIAL_VERSION);assert.equal(frozen.manifest.formats.specPackage,'0.1.0-draft.9');assert.equal(frozen.manifest.formats.specSha256,'dbaacc7c16d82b10992fe95ac35f0aca35d2781a65a0ee1a1af69dae1f838d5a');
  assert(frozen.manifest.formats.migrations.includes('020_surface_material_resources.sql:'+sha256(await readFile(new URL('../database/migrations/020_surface_material_resources.sql',import.meta.url)))));
  const bundle=await json(request('POST',`/studio/exhibitions/${id}/freezes/${frozen.id}/offline`,{seconds:300}));
  await verifyFreezeBundle(Buffer.from(JSON.stringify(bundle)),{trustedKeys:[sha256(keys.publicKey.export({format:'der',type:'spki'}))]});
  const frozenArchive=await readOex(Buffer.from(bundle.oex,'base64'));assert.deepEqual(frozenArchive.manifest.materialResources,expectedResources);for(const resource of expectedResources)assert.deepEqual(frozenArchive.files.get(resource.path),files.get(resource.artifactPath));
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM oex_import_jobs WHERE tenant_id=$1 AND (cleanup_pending OR state<>'complete')",[workspace.tenantId])).rows[0].count,0);
 });
}finally{if(app)await app.close();await pool.end();}
