// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic API/SQL/output boundary proof, never a rendered-space or GUI claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {fixtureURL,readOex,OEX_SPACE_STILL_VERSION} from '@exhibitos/spec';
import {SPACE_STILL_NAMESPACE as N,spaceStillFor} from '@exhibitos/spec/space-still';
import {ENTRANCE_NAMESPACE} from '@exhibitos/studio-contract';
import {migrate,FileBlobStore,sha256} from '../packages/storage/dist/index.js';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Oex} from '../apps/api/dist/oex.js';
import {exportStaticPublication} from './export-static-publication.mjs';
const database=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(database.hostname!=='127.0.0.1'||!database.pathname.startsWith('/exhibitos_native_session_test_')||!process.env.EXHIBITOS_TEST_OUTPUT)throw Error('ISOLATED_SPACE_STILL_FIXTURE_REQUIRED');
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
 await test('independent still uses protected approval, saved draft, OEX roundtrip and public static inventory with exact original bytes',async()=>{
  const sourceBytes=await readFile(fixtureURL('oex/v1/examples/synthetic-space-still.oex')),source=await readOex(sourceBytes),sourceStill=spaceStillFor(source.exhibition),png=source.files.get('assets/'+sourceStill.path);
  const base=await imported(sourceBytes),exhibitionId=base.exhibitionId,path=`/studio/exhibitions/${exhibitionId}/cover-images`,draft=structuredClone(base.draft),untouched=structuredClone({artworks:draft.candidate.artworks,media:draft.candidate.mediaAssets});
  const image=await json(request('POST',path,{requestId:randomUUID(),mime:'image/png',bytes:png.length,sha256:sha256(png),rights:sourceStill.rights}),201);
  assert.equal(image.state,'uploading');
  const corrupt=Buffer.from(png);corrupt[corrupt.length-1]^=1;await expected(request('PUT',`${path}/${image.id}/bytes`,corrupt),422);
  await expected(request('PUT',`${path}/${image.id}/bytes`,png),200);const approved=await json(request('POST',`${path}/${image.id}/approve`,{revision:1}));assert.equal(approved.state,'approved');assert.equal(approved.asset.sha256,sha256(png));
  await expected(app.inject({method:'GET',url:prefix+path+'/'+image.id,headers:{host:headers.host,origin}}),401);
  await expected(app.inject({method:'GET',url:`/api/v1/tenants/${randomUUID()}${path}/${image.id}`,headers}),403);
  await expected(request('POST',`${path}/${image.id}/revoke`,{},{'x-csrf-token':'invalid'}),403);
  const preview=await expected(request('GET',`${path}/${image.id}/preview?expectedSha256=${approved.asset.sha256}`),200);assert.equal(preview.headers['x-exhibitos-watermarked'],'true');assert.equal(preview.headers['x-exhibitos-cover-sha256'],sha256(png));
  draft.editVersion++;draft.updatedAt=new Date().toISOString();draft.candidate.extensions={...draft.candidate.extensions,[N]:{version:1,asset:approved.asset},[ENTRANCE_NAMESPACE]:{version:1,artist:'Synthetic creator',introduction:'Synthetic binary boundary only',imageAssetId:image.id,imageAlt:'Original synthetic empty-room diagram',mobilePosition:'center',design:{version:1,theme:'threshold'}}};
  const saved=await json(request('PUT',`/studio/exhibitions/${exhibitionId}`,{requestId:randomUUID(),draft},{'if-match':base.etag}));
  const reopened=await json(request('GET',`/studio/exhibitions/${exhibitionId}`));assert.deepEqual(reopened.draft,saved.draft);assert.deepEqual(spaceStillFor(reopened.draft.candidate),approved.asset);assert.deepEqual({artworks:reopened.draft.candidate.artworks,media:reopened.draft.candidate.mediaAssets},untouched);
  const exported=await expected(request('POST',`/studio/exhibitions/${exhibitionId}/oex/export`,{},{'if-match':saved.etag}),200),roundtrip=await readOex(exported.rawPayload),still=spaceStillFor(roundtrip.exhibition);
  assert.equal(roundtrip.manifest.formatVersion,OEX_SPACE_STILL_VERSION);assert.deepEqual(roundtrip.files.get('assets/'+still.path),png);assert.deepEqual(still,approved.asset);
  const restored=await imported(exported.rawPayload),mapped=spaceStillFor(restored.draft.candidate);assert.notEqual(mapped.id,still.id);assert.equal(restored.draft.candidate.extensions[ENTRANCE_NAMESPACE].imageAssetId,mapped.id);assert.equal(mapped.sha256,sha256(png));assert.equal(mapped.path,`space-still/${mapped.id}/image.png`);
  const ready=await json(request('GET',`/studio/exhibitions/${exhibitionId}/ready`));assert.equal(ready.status,'READY',JSON.stringify(ready));assert.deepEqual(ready.issues,[],JSON.stringify(ready));
  const publication=await json(request('POST',`/studio/exhibitions/${exhibitionId}/publications`,{requestId:randomUUID()},{'if-match':saved.etag}),201);
  const anonymous=()=>app.inject({method:'GET',url:`/api/v1/publications/${publication.publicationId}`,headers:{host:headers.host}});
  const publicValue=(await expected(anonymous(),200)).json(),publicStill=spaceStillFor(publicValue.exhibition);assert.notEqual(publicStill.id,image.id);assert.equal(publicValue.exhibition.extensions[ENTRANCE_NAMESPACE].imageAssetId,publicStill.id);
  const publicImage=await expected(app.inject({method:'GET',url:`/api/v1/publications/${publication.publicationId}/assets/${publicStill.id}`,headers:{host:headers.host}}),200);assert.deepEqual(publicImage.rawPayload,png);
  const fetcher=async input=>{const url=new URL(input),result=await app.inject({method:'GET',url:url.pathname+url.search,headers:{host:headers.host}});return new Response(new Uint8Array(result.rawPayload),{status:result.statusCode,headers:result.headers});};
  const target=join(output,'static'),receipt=await exportStaticPublication({origin,publicationId:publication.publicationId,runtimeRoot:resolve('apps/web/dist-static'),output:target,fetcher});assert.equal(receipt.publicationId,publication.publicationId);
  const index=JSON.parse(await readFile(join(target,'static-publication-index.json'),'utf8')),entry=index.assets.find(a=>a.assetId===publicStill.id);assert(entry);assert.equal(entry.sha256,sha256(png));assert.deepEqual(await readFile(join(target,entry.path)),png);
  const exportedPublication=JSON.parse(await readFile(join(target,index.publication.path),'utf8'));assert.deepEqual(spaceStillFor(exportedPublication.exhibition),publicStill);assert.match(await readFile(join(target,'index.html'),'utf8'),/entrance-theme-threshold/);
  await assert.rejects(pool.query('UPDATE studio_cover_images SET sha256=$3 WHERE tenant_id=$1 AND id=$2',[workspace.tenantId,image.id,'b'.repeat(64)]));
  await expected(request('POST',`${path}/${image.id}/revoke`,{}),200);await expected(anonymous(),404);await expected(request('GET',`${path}/${image.id}/preview?expectedSha256=${approved.asset.sha256}`),403);
  await expected(request('POST',`${path}/${image.id}/restore`,{}),200);await expected(anonymous(),200);assert.deepEqual((await json(request('GET',`${path}/${image.id}`))).asset,approved.asset);
 });
}finally{if(app)await app.close();await pool.end();}
