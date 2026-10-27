// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic API/SQL/output boundary proof, never a rendered-space or GUI claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {fixtureURL,readOex,writeOex} from '@exhibitos/spec';
import {spaceStillFor} from '@exhibitos/spec/space-still';
import {FLOOR_NAMESPACE as N,floorPresetDefaults} from '@exhibitos/studio-contract';
import {OEX_FLOOR_RESOURCE_VERSION,packageFloorResourceManifest} from '@exhibitos/spec/floor-resources';
import {migrate,FileBlobStore,sha256} from '../packages/storage/dist/index.js';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Oex} from '../apps/api/dist/oex.js';
import {exportStaticPublication} from './export-static-publication.mjs';
const database=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(database.hostname!=='127.0.0.1'||!database.pathname.startsWith('/exhibitos_native_session_test_')||!process.env.EXHIBITOS_TEST_OUTPUT)throw Error('ISOLATED_FLOOR_RESOURCE_FIXTURE_REQUIRED');
const output=resolve(process.env.EXHIBITOS_TEST_OUTPUT),pool=new Pool({connectionString:database.href,max:4,statement_timeout:10000});
await mkdir(output,{recursive:true,mode:0o700});
const workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const origin='http://127.0.0.1:3000',headers={host:'127.0.0.1:3000',origin,cookie:`exhibitos_local_session=${workspace.sessionToken}`,'x-csrf-token':workspace.csrfToken};
let app;
try{
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);await openLocalWorkspace(pool,workspace,'native');
 const blobs=new FileBlobStore(join(output,'blobs'));app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});const worker=new Oex(pool,blobs),prefix=`/api/v1/tenants/${workspace.tenantId}`;
 const request=(method,path,payload,extra={})=>app.inject({method,url:prefix+path,headers:{...headers,...(Buffer.isBuffer(payload)?{'content-type':'application/octet-stream'}:{}),...extra},...(payload===undefined?{}:{payload})});
 const expected=async(promise,status)=>{const response=await promise;let code='';if(response.statusCode!==status){try{code=response.json().code??'';}catch{/* Non-JSON error bodies still report their actual HTTP status. */}}assert.equal(response.statusCode,status,'HTTP boundary '+code);return response;};
 const json=async(promise,status=200)=>(await expected(promise,status)).json();
 const imported=async bytes=>{
  const job=await json(request('POST','/oex/imports',{requestId:randomUUID(),bytes:bytes.length,sha256:sha256(bytes)}),201);await expected(request('PUT',`/oex/imports/${job.id}/bytes`,bytes),200);await expected(request('POST',`/oex/imports/${job.id}/complete`,{}),200);await worker.run(job.id);
  const result=await json(request('GET',`/oex/imports/${job.id}`));assert.equal(result.state,'complete','OEX worker did not complete: '+result.errorCode);return result.result;
 };
 await test('selected floor maps and notices survive protected import, immutable storage, save, OEX re-export and public static output',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-space-still.oex'))),e=structuredClone(original.exhibition);
  const room=e.rooms[0],authored=e.surfaces.find(s=>s.type==='floor'&&s.roomId===room.id),target=authored?{kind:'surface',surfaceId:authored.id}:{kind:'room-base',roomId:room.id};
  e.extensions={...e.extensions,[N]:{version:1,bindings:[{...floorPresetDefaults('wood'),target,normalScale:0,aoStrength:0}]}};
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)]));
  const expectedResources=packageFloorResourceManifest(e);
  for(const resource of expectedResources){
   if(resource.role==='notice'){const {FLOOR_RESOURCE_PACKS,floorResourceNotice}=await import('@exhibitos/spec/floor-resources');files.set(resource.artifactPath,Buffer.from(floorResourceNotice(FLOOR_RESOURCE_PACKS.find(p=>p.id===resource.packId))));}
   else files.set(resource.artifactPath,await readFile(new URL('../apps/web/public/'+resource.artifactPath,import.meta.url)));
  }
  const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),base=await imported(archive),id=base.exhibitionId;
  assert.notEqual(id,e.id);const mapped=base.draft.candidate.extensions[N].bindings[0];assert.deepEqual(mapped.target,authored?{kind:'surface',surfaceId:base.idMap[authored.id]}:{kind:'room-base',roomId:base.idMap[room.id]});
  const rows=(await pool.query('SELECT * FROM studio_floor_resources WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY resource_path',[workspace.tenantId,id])).rows;assert.equal(rows.length,4);
  for(const row of rows){const resource=expectedResources.find(f=>f.artifactPath===row.resource_path);assert(resource);const bytes=await blobs.get(row.object_key);assert.equal(sha256(bytes),resource.sha256);assert.deepEqual(Buffer.from(bytes),files.get(resource.artifactPath));}
  await assert.rejects(pool.query('UPDATE studio_floor_resources SET sha256=$3 WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,id,'0'.repeat(64)]));
  const draft=structuredClone(base.draft);draft.editVersion++;draft.updatedAt=new Date().toISOString();draft.candidate.title='Synthetic portable floor proof';
  const saved=await json(request('PUT',`/studio/exhibitions/${id}`,{requestId:randomUUID(),draft},{'if-match':base.etag})),reopened=await json(request('GET',`/studio/exhibitions/${id}`));assert.deepEqual(reopened.draft,saved.draft);
  const exported=await expected(request('POST',`/studio/exhibitions/${id}/oex/export`,{},{'if-match':saved.etag}),200),roundtrip=await readOex(exported.rawPayload);assert.equal(roundtrip.manifest.formatVersion,OEX_FLOOR_RESOURCE_VERSION);
  assert.deepEqual(roundtrip.manifest.floorResources,expectedResources);for(const resource of expectedResources)assert.deepEqual(roundtrip.files.get(resource.path),files.get(resource.artifactPath));
  assert.equal(spaceStillFor(roundtrip.exhibition).sha256,spaceStillFor(e).sha256);
  const restored=await imported(exported.rawPayload);assert.notEqual(restored.exhibitionId,id);assert.equal((await pool.query('SELECT count(*)::int AS count FROM studio_floor_resources WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,restored.exhibitionId])).rows[0].count,4);
  const publication=await json(request('POST',`/studio/exhibitions/${id}/publications`,{requestId:randomUUID()},{'if-match':saved.etag}),201);
  const fetcher=async input=>{const url=new URL(input),result=await app.inject({method:'GET',url:url.pathname+url.search,headers:{host:headers.host}});return new Response(new Uint8Array(result.rawPayload),{status:result.statusCode,headers:result.headers});};
  const result=await exportStaticPublication({origin,publicationId:publication.publicationId,runtimeRoot:resolve('apps/web/dist-static'),output:join(output,'static-floor'),fetcher});
  const manifest=JSON.parse(await readFile(join(result.output,'static-export-manifest.json'),'utf8')),maps=expectedResources.filter(f=>f.role!=='notice');assert.deepEqual(manifest.files.filter(f=>f.path.startsWith('floor-textures/')).map(f=>f.path).sort(),maps.map(f=>f.artifactPath).sort());
  for(const resource of maps)assert.deepEqual(await readFile(join(result.output,resource.artifactPath)),files.get(resource.artifactPath));
  assert((await readFile(join(result.output,'floor-texture-notices.txt'),'utf8')).includes('WoodFloor051'));
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM oex_import_jobs WHERE tenant_id=$1 AND (cleanup_pending OR state<>'complete')",[workspace.tenantId])).rows[0].count,0);
 });
}finally{if(app)await app.close();await pool.end();}
