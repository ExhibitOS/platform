// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated SQL/API/output evidence; this is not a device or listening test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {fixtureURL,readOex,writeOex} from '@exhibitos/spec';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {migrate,FileBlobStore,sha256,transaction,collectServiceInventory} from '../packages/storage/dist/index.js';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Oex} from '../apps/api/dist/oex.js';
import {Privacy} from '../apps/api/dist/privacy.js';
import {exportStaticPublication} from './export-static-publication.mjs';
const database=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(database.hostname!=='127.0.0.1'||!database.pathname.startsWith('/exhibitos_native_session_test_')||!process.env.EXHIBITOS_TEST_OUTPUT)throw Error('ISOLATED_FOOTSTEP_RESOURCE_FIXTURE_REQUIRED');
const output=resolve(process.env.EXHIBITOS_TEST_OUTPUT),pool=new Pool({connectionString:database.href,max:4,statement_timeout:10000});
await mkdir(output,{recursive:true,mode:0o700});
const workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const origin='http://127.0.0.1:3000',headers={host:'127.0.0.1:3000',origin,cookie:`exhibitos_local_session=${workspace.sessionToken}`,'x-csrf-token':workspace.csrfToken};
let app;
try{
 await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);await openLocalWorkspace(pool,workspace,'native');
 const blobs=new FileBlobStore(join(output,'blobs'));app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});const worker=new Oex(pool,blobs),prefix=`/api/v1/tenants/${workspace.tenantId}`;
 const request=(method,path,payload,extra={})=>app.inject({method,url:prefix+path,headers:{...headers,...(Buffer.isBuffer(payload)?{'content-type':'application/octet-stream'}:{}),...extra},...(payload===undefined?{}:{payload})});
 const expected=async(promise,status)=>{const response=await promise;let code='';if(response.statusCode!==status){try{code=response.json().code??'';}catch{code='';}}assert.equal(response.statusCode,status,'HTTP boundary '+code);return response;};
 const json=async(promise,status=200)=>(await expected(promise,status)).json();
 const imported=async bytes=>{const job=await json(request('POST','/oex/imports',{requestId:randomUUID(),bytes:bytes.length,sha256:sha256(bytes)}),201);await expected(request('PUT',`/oex/imports/${job.id}/bytes`,bytes),200);await expected(request('POST',`/oex/imports/${job.id}/complete`,{}),200);await worker.run(job.id);const result=await json(request('GET',`/oex/imports/${job.id}`));assert.equal(result.state,'complete','OEX worker: '+result.errorCode);return result.result;};
 await test('registered footsteps survive OEX import, save, publication and static output',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),e=structuredClone(original.exhibition);
  e.extensions={...e.extensions,'org.exhibitos.viewer/footstep-resources':{version:1,families:['carpet','concrete','marble','tile','wood']}};
  const selected=footstepResourcesFor(e),files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)]));
  for(const item of selected)files.set(item.artifactPath,await readFile(new URL('../apps/web/public/'+item.artifactPath,import.meta.url)));
  const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),base=await imported(archive),id=base.exhibitionId;
  const rows=(await pool.query('SELECT * FROM studio_footstep_resources WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY resource_path',[workspace.tenantId,id])).rows;assert.equal(rows.length,13);
  for(const row of rows){const descriptor=selected.find(v=>v.artifactPath===row.resource_path);assert(descriptor);assert.equal(sha256(await blobs.get(row.object_key)),descriptor.sha256);}
  await assert.rejects(pool.query('UPDATE studio_footstep_resources SET sha256=$3 WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,id,'0'.repeat(64)]));
  const draft=structuredClone(base.draft);draft.editVersion++;draft.updatedAt=new Date().toISOString();draft.candidate.title='Synthetic footstep portability proof';
  const saved=await json(request('PUT',`/studio/exhibitions/${id}`,{requestId:randomUUID(),draft},{'if-match':base.etag})),reopened=await json(request('GET',`/studio/exhibitions/${id}`));assert.deepEqual(reopened.draft,saved.draft);
  const exported=await expected(request('POST',`/studio/exhibitions/${id}/oex/export`,{},{'if-match':saved.etag}),200),roundtrip=await readOex(exported.rawPayload);assert.equal(roundtrip.manifest.formatVersion,'1.0.0-draft.8');assert.deepEqual(roundtrip.manifest.footstepResources,selected);
  const restored=await imported(exported.rawPayload);assert.notEqual(restored.exhibitionId,id);
  await transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(82002)');const report=await collectServiceInventory(c,blobs,{migrationDirectory:resolve('database/migrations')});assert.deepEqual(report.issues,[]);for(const row of rows){assert(report.references.some(r=>r.key===row.object_key&&r.required&&r.expectedSha256===row.sha256));assert.equal(await new Privacy(pool,blobs).referenced(c,row.object_key),true);}});
  const publication=await json(request('POST',`/studio/exhibitions/${id}/publications`,{requestId:randomUUID()},{'if-match':saved.etag}),201),baseUrl=`/api/v1/publications/${publication.publicationId}`;
  const host=await json(request('POST',`/studio/publications/${publication.publicationId}/opening-host`,{revisionSha256:publication.revisionSha256}));assert.equal(typeof host.hostGrant,'string');
  await expected(app.inject({method:'GET',url:baseUrl,headers:{host:headers.host}}),406);
  const projection=await json(app.inject({method:'GET',url:baseUrl+'?footsteps=1',headers:{host:headers.host}}));assert.equal(projection.resources.length,13);
  const sample=selected.find(v=>v.role==='sample'),response=await expected(app.inject({method:'GET',url:baseUrl+'/resources/'+sample.sha256,headers:{host:headers.host}}),200);assert.equal(sha256(response.rawPayload),sample.sha256);
  await expected(app.inject({method:'GET',url:baseUrl+'/resources/'+'0'.repeat(64),headers:{host:headers.host}}),404);
  const runtime=join(output,'runtime');await mkdir(runtime);await writeFile(join(runtime,'static.html'),'<meta name="exhibitos-static-index" content="STATIC_INDEX_SHA256">');
  const fetcher=async input=>{const url=new URL(input),result=await app.inject({method:'GET',url:url.pathname+url.search,headers:{host:headers.host}});return new Response(new Uint8Array(result.rawPayload),{status:result.statusCode,headers:result.headers});};
  const result=await exportStaticPublication({origin,publicationId:publication.publicationId,runtimeRoot:runtime,output:join(output,'static'),fetcher}),index=JSON.parse(await readFile(join(result.output,'static-publication-index.json')));assert.equal(index.version,2);assert.equal(index.resources.length,13);
 });
}finally{if(app)await app.close();await pool.end();}
