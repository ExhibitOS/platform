// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated synthetic API/SQL/OEX proof; no GUI, deployment or native recovery claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {fixtureURL,readOex,writeOex} from '@exhibitos/spec';
import {applyBenchCommand,applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {migrate,FileBlobStore,sha256,transaction,collectServiceInventory} from '@exhibitos/storage';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {buildApp} from '../apps/api/dist/app.js';
import {Oex} from '../apps/api/dist/oex.js';
import {Privacy} from '../apps/api/dist/privacy.js';
const database=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(database.hostname!=='127.0.0.1'||!database.pathname.startsWith('/exhibitos_native_session_test_')||!process.env.EXHIBITOS_TEST_OUTPUT)throw Error('ISOLATED_FURNISHING_FIXTURE_REQUIRED');
const output=resolve(process.env.EXHIBITOS_TEST_OUTPUT),pool=new Pool({connectionString:database.href,max:4,statement_timeout:10000});
await mkdir(output,{recursive:true,mode:0o700});
const workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')};
const origin='http://127.0.0.1:3000',headers={host:'127.0.0.1:3000',origin,cookie:`exhibitos_local_session=${workspace.sessionToken}`,'x-csrf-token':workspace.csrfToken};
let app;
try{
 await migrate(pool,resolve('database/migrations'));await openLocalWorkspace(pool,workspace,'native');
 const blobs=new FileBlobStore(join(output,'blobs'));app=buildApp({pool,blobs,auth:{mode:'local',origin,bindHost:'127.0.0.1'}});const worker=new Oex(pool,blobs),prefix=`/api/v1/tenants/${workspace.tenantId}`;
 const request=(method,path,payload,extra={})=>app.inject({method,url:prefix+path,headers:{...headers,...(Buffer.isBuffer(payload)?{'content-type':'application/octet-stream'}:{}),...extra},...(payload===undefined?{}:{payload})});
 const expected=async(promise,status)=>{const response=await promise;let code='';if(response.statusCode!==status){try{code=response.json().code??'';}catch{/* Preserve actual non-JSON status. */}}assert.equal(response.statusCode,status,'HTTP boundary '+code);return response;};
 const json=async(promise,status=200)=>(await expected(promise,status)).json();
 const imported=async bytes=>{
  const job=await json(request('POST','/oex/imports',{requestId:randomUUID(),bytes:bytes.length,sha256:sha256(bytes)}),201);await expected(request('PUT',`/oex/imports/${job.id}/bytes`,bytes),200);await expected(request('POST',`/oex/imports/${job.id}/complete`,{}),200);await worker.run(job.id);
  const result=await json(request('GET',`/oex/imports/${job.id}`));assert.equal(result.state,'complete','OEX worker did not complete: '+result.errorCode);return result.result;
 };
 await test('qualified furnishing pairs survive protected OEX intake, reopen, export, backup references and current public authorization',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')));let e=structuredClone(original.exhibition);
  const room=e.rooms[0],benchId=randomUUID(),viewpointId=randomUUID();
  e=applyBenchCommand(e,{type:'add-bench',bench:{id:benchId,name:'Bench',roomId:room.id,position:[0,0,1.5],yaw:0,kind:'slab',dimensions:{width:1.5,height:.45,depth:.5},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId:room.id,position:[0,1.15,1.5],target:[0,1.15,-2],fov:50}});
  const light=e.lights[0];light.type='spot';light.beamAngle=Math.PI/4;
  const opening=e.openings[0],wall=e.surfaces.find(s=>s.id===opening.surfaceId);opening.offset[1]=(2.2-wall.dimensions.height)/2;
  const sculpture=e.artworks.find(a=>a.artworkType==='sculpture'),placement=e.placements.find(p=>p.artworkRevisionId===sculpture.revisionId);
  const commands=[
   {hostKind:'bench',hostId:benchId,catalogId:'backless-oak-bench',pose:{position:[0,0,1.5],yaw:0,scale:1}},
   {hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',pose:{position:[0,.15,.0755],yaw:0,scale:1}},
   {hostKind:'opening',hostId:opening.id,catalogId:'gallery-open-portal',pose:{position:[opening.offset[0],-wall.dimensions.height/2,0],yaw:0,scale:1}},
   {hostKind:'pedestal',hostId:placement.id,catalogId:'rectangular-plinth',pose:{position:[...placement.transform.position],yaw:0,scale:1}},
  ];for(const command of commands)e=applyFurnishingCommand(e,{type:'set-furnishing-visual',catalogVersion:1,...command});
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)]));
  for(const asset of furnishingsFor(e).assets){const entry=furnishingCatalogueEntry(asset.catalogId);files.set(asset.path,await readFile(new URL('../'+entry.path,import.meta.url)));files.set(asset.rights.notice.path,await readFile(new URL('../'+entry.rights.noticePath,import.meta.url)));}
  const archive=await writeOex(e,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),base=await imported(archive),id=base.exhibitionId;
  const selected=furnishingsFor(base.draft.candidate);assert.equal(selected.assets.length,4);assert.equal(selected.bindings.length,4);
  const rows=(await pool.query('SELECT * FROM studio_furnishing_resources WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY catalog_id,role',[workspace.tenantId,id])).rows;assert.equal(rows.length,8);
  for(const row of rows){const asset=selected.assets.find(a=>a.catalogId===row.catalog_id),descriptor=row.role==='model'?asset:asset.rights.notice,bytes=Buffer.from(await blobs.get(row.object_key));assert.equal(bytes.length,descriptor.bytes);assert.equal(sha256(bytes),descriptor.sha256);assert(row.object_key.startsWith(workspace.tenantId+'/'));}
  await assert.rejects(pool.query('UPDATE studio_furnishing_resources SET sha256=$3 WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,id,'0'.repeat(64)]));
  const reopened=await json(request('GET',`/studio/exhibitions/${id}`));assert.deepEqual(reopened.draft,base.draft);
  const exported=await expected(request('POST',`/studio/exhibitions/${id}/oex/export`,{},{'if-match':base.etag}),200),roundtrip=await readOex(exported.rawPayload);
  assert.deepEqual(furnishingsFor(roundtrip.exhibition),selected);
  for(const asset of selected.assets){assert.equal(sha256(roundtrip.files.get('assets/'+asset.path)),asset.sha256);assert.equal(sha256(roundtrip.files.get('resources/'+asset.rights.notice.path)),asset.rights.notice.sha256);}
  const restored=await imported(exported.rawPayload);assert.notEqual(restored.exhibitionId,id);assert.equal((await pool.query('SELECT count(*)::int AS count FROM studio_furnishing_resources WHERE tenant_id=$1 AND exhibition_id=$2',[workspace.tenantId,restored.exhibitionId])).rows[0].count,8);
  const inventory=await transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(82002)');const report=await collectServiceInventory(c,blobs,{migrationDirectory:resolve('database/migrations')});assert.deepEqual(report.issues,[]);assert.equal(report.tables.find(t=>t.name==='studio_furnishing_resources').rowCount,16);for(const row of rows){assert(report.references.some(r=>r.key===row.object_key&&r.required&&r.expectedSha256===row.sha256));assert.equal(await new Privacy(pool,blobs).referenced(c,row.object_key),true);}return report;});
  const publication=await json(request('POST',`/studio/exhibitions/${id}/publications`,{requestId:randomUUID()},{'if-match':base.etag}),201),url=`/api/v1/publications/${publication.publicationId}`;
  const publicRead=path=>app.inject({method:'GET',url:path,headers:{host:headers.host}}),metadata=(await expected(publicRead(url),200)).json();
  assert.equal(metadata.furnishingNotices.length,4);const publicFurniture=furnishingsFor(metadata.exhibition);assert.equal(publicFurniture.assets.length,4);
  for(const asset of publicFurniture.assets){assert(!selected.assets.some(a=>a.id===asset.id));const model=await expected(publicRead(`${url}/assets/${asset.id}`),200),notice=await expected(publicRead(`${url}/furnishing-notices/${asset.id}`),200);assert.equal(sha256(model.rawPayload),asset.sha256);assert.equal(sha256(notice.rawPayload),asset.rights.notice.sha256);assert.equal(notice.headers['cache-control'],'no-store');assert.equal(notice.headers['x-exhibitos-publication-revision'],publication.revisionSha256);}
  await expected(publicRead(`${url}/assets/${randomUUID()}`),404);await expected(publicRead(`${url}/furnishing-notices/${randomUUID()}`),404);
  const damaged=rows.find(r=>r.role==='notice'),originalNotice=Buffer.from(await blobs.get(damaged.object_key));
  // Simulate external corruption only inside this newly owned synthetic store;
  // the product BlobStore correctly refuses overwriting immutable objects.
  await writeFile(join(output,'corruption-before-notice.bin'),originalNotice);
  const damagedPath=join(output,'blobs',damaged.object_key);await writeFile(damagedPath,Buffer.from('changed owned synthetic fixture notice'));
  await expected(publicRead(url),404);await expected(publicRead(`${url}/assets/${publicFurniture.assets[0].id}`),404);await expected(publicRead(`${url}/furnishing-notices/${publicFurniture.assets[0].id}`),404);await writeFile(damagedPath,originalNotice);
  await json(request('POST',`/studio/publications/${publication.publicationId}/unpublish`,{}));await expected(publicRead(url),404);await expected(publicRead(`${url}/furnishing-notices/${publicFurniture.assets[0].id}`),404);
  await json(request('POST',`/studio/publications/${publication.publicationId}/republish`,{}));await expected(publicRead(url),200);
  await pool.query('UPDATE exhibitions SET deleted_at=now() WHERE tenant_id=$1 AND id=$2',[workspace.tenantId,id]);await expected(publicRead(url),404);await expected(publicRead(`${url}/assets/${publicFurniture.assets[0].id}`),404);await expected(publicRead(`${url}/furnishing-notices/${publicFurniture.assets[0].id}`),404);
  await writeFile(join(output,'result.json'),JSON.stringify({status:'PASS_ISOLATED_FURNISHING_API_OEX_SQL',catalogueItems:4,modelNoticeRows:8,reimportedRows:8,backupReferences:16,exactModelsAndNotices:true,typedPublicRemap:true,unknownIdsDenied:true,corruptNoticeDeniesAll:true,withdrawalAndDeletedParentDenyAll:true,sourceExhibition:id,publicationId:publication.publicationId,schemaDigest:inventory.schemaDigest,gui:false,deployed:false,nativeRecoveryQualified:false},null,2));
 });
}finally{if(app)await app.close();await pool.end();}
