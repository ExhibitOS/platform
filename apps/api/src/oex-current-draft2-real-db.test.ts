// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,mkdtemp,writeFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {FileBlobStore,migrate,sha256,transaction} from '@exhibitos/storage';
import {fixtureURL,readOex,writeOex,withOexFileHandle,type Exhibition,type Artwork} from '@exhibitos/spec';
import {LOD_NAMESPACE,BUDGET_GEOMETRY_PAIR_PROFILE} from '@exhibitos/studio-contract';
import {Oex,requireSupportedOexImport,checkOexProfile} from './oex.ts';
import {Cms} from './cms.ts';
import {Studio,etag} from './studio.ts';
import {decodePackedWorkspaceOexDocuments} from './oex-packed-documents-v2.ts';
import {importedArtworkMetadata,IMPORTED_DISPLAY_REFERENCE} from './imported-artwork-metadata.ts';
import type {Session} from './auth.ts';
const eligible=!!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL&&!!process.env.EXHIBITOS_CURRENT_OEX_PATH;
it.skipIf(!eligible)('round-trips current draft2 reference and budget pair through real isolated CMS, save/reopen and OEX',async()=>{
 const path=process.env.EXHIBITOS_CURRENT_OEX_PATH!,digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);expect(digest.digest('hex')).toBe(process.env.EXHIBITOS_CURRENT_OEX_SHA256);
 const file=await open(path,'r');let source!:Artwork;const sourceFiles=new Map<string,Uint8Array>();
 try{await withOexFileHandle(file,async({manifest,exhibition,files})=>{
  expect(manifest.formatVersion).toBe('1.0.0-draft.12');expect(exhibition.schemaVersion).toBe('1.0.0-draft.2');
  checkOexProfile(exhibition,false,'bounded-file-v1',true);requireSupportedOexImport(exhibition);
  const manifestBytes=await files.get('manifest.json'),exhibitionBytes=await files.get(manifest.exhibition.path);if(!manifestBytes||!exhibitionBytes)throw Error('missing source documents');
  const decoded=decodePackedWorkspaceOexDocuments(manifestBytes,sha256(manifestBytes),exhibitionBytes,sha256(exhibitionBytes));expect(decoded.exhibition).toEqual(exhibition);
  const match=exhibition.artworks.find(a=>(a.extensions?.[LOD_NAMESPACE] as {profile?:string}|undefined)?.profile===BUDGET_GEOMETRY_PAIR_PROFILE&&a.units==='unknown');if(!match)throw Error('missing actual unknown-unit budget pair');source=structuredClone(match);
  for(const asset of source.assets){const bytes=await files.get(`assets/${asset.path}`);if(!bytes)throw Error('missing source asset');expect(sha256(bytes)).toBe(asset.sha256);sourceFiles.set(asset.path,bytes);}
 });}finally{await file.close();}
 // The full saved draft.12 archive is read-only admission evidence above. This
 // smaller current-format scene isolates its unchanged actual artwork/bytes from
 // unrelated native workspace materials; it is not a c567/native import claim.
 const fixture=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),base=fixture.exhibition.artworks.find(a=>a.artworkType==='sculpture')!;
 const scene={...fixture.exhibition,schemaVersion:'1.0.0-draft.2',artworks:fixture.exhibition.artworks.map(a=>a.id===base.id?source:a),placements:fixture.exhibition.placements.map(p=>p.artworkRevisionId===base.revisionId?{...p,artworkRevisionId:source.revisionId,assetId:source.primaryAssetId}:p)} as Exhibition;
 const assets=new Map<string,Uint8Array>(sourceFiles);for(const a of scene.artworks)if(a.id!==source.id)for(const asset of a.assets)assets.set(asset.path,fixture.files.get(`assets/${asset.path}`)!);
 const encoded=Buffer.from(await writeOex(scene,assets,{createdAt:new Date().toISOString(),generator:{name:'isolated-current-draft2-test',version:'1'}}));
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL}),tenantId=randomUUID(),userId=randomUUID(),session={tenantId,userId,role:'admin'} as Session,root=await mkdtemp(join(tmpdir(),'current-oex-roundtrip-')),blobs=new FileBlobStore(root),oex=new Oex(pool,blobs),studio=new Studio(),cms=new Cms(blobs),run=<T>(fn:(c:import('pg').PoolClient)=>Promise<T>)=>transaction(pool,fn);
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);await migrate(pool,new URL('../../../database/native-model-preparation/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated current draft2 roundtrip']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  const created=await run(c=>oex.create(c,session,{requestId:randomUUID(),bytes:encoded.length,sha256:sha256(encoded)})),jobId=String(created.id);
  await run(c=>oex.upload(c,session,jobId,encoded));await run(c=>oex.complete(c,session,jobId));expect(await oex.run(jobId)).toBe(true);
  const job=await run(c=>oex.access(c,session,jobId));expect(job.state,JSON.stringify(job)).toBe('complete');
  const result=job.result as {exhibitionId:string;idMap:Record<string,string>},artworkId=result.idMap[source.id]!;
  const detail=await run(c=>cms.detail(c,session,artworkId)),expected=importedArtworkMetadata(source);expect(detail.metadata).toEqual(expected);expect(detail.approvedRevision).toBe(1);
  const projected=(await run(c=>cms.studioArtwork(c,session,artworkId))).artwork;
  expect(projected.units).toBe('unknown');expect(projected.dimensions).toEqual(source.dimensions);expect(projected.transform).toEqual(source.transform);expect(projected.rights).toEqual(source.rights);expect(projected.extensions?.[IMPORTED_DISPLAY_REFERENCE]).toEqual(source.extensions?.[IMPORTED_DISPLAY_REFERENCE]);
  const fingerprint=(a:Artwork)=>({assets:a.assets.map(x=>({sha256:x.sha256,bytes:x.bytes,mime:x.mime})).sort((a,b)=>a.sha256.localeCompare(b.sha256)),lod:(a.extensions?.[LOD_NAMESPACE] as {profile:string;variants:Array<{assetId:string;detail:string;triangles:number;textureSize:number}>})?.variants.map(v=>({...v,assetId:a.assets.find(x=>x.id===v.assetId)!.sha256}))});
  expect(fingerprint(projected)).toEqual(fingerprint(source));
  const row=await run(c=>studio.access(c,session,result.exhibitionId)),saved=await run(c=>studio.put(c,session,result.exhibitionId,{draft:row.metadata,requestId:randomUUID()},etag(row.revision,row.metadata)));
  const reopened=new Studio(),current=await run(c=>reopened.access(c,session,result.exhibitionId));expect(current.metadata).toEqual(saved.draft);
  const output=Buffer.from(await run(c=>new Oex(pool,blobs).export(c,session,result.exhibitionId,etag(current.revision,current.metadata)))),readback=await readOex(output),again=readback.exhibition.artworks.find(a=>a.id===artworkId)!;
  expect(readback.exhibition.schemaVersion).toBe('1.0.0-draft.2');expect(again.units).toBe(source.units);expect(again.transform).toEqual(source.transform);expect(again.rights).toEqual(source.rights);expect(again.extensions?.[IMPORTED_DISPLAY_REFERENCE]).toEqual(source.extensions?.[IMPORTED_DISPLAY_REFERENCE]);expect(fingerprint(again)).toEqual(fingerprint(source));
  for(const asset of again.assets)expect(sha256(readback.files.get(`assets/${asset.path}`)!)).toBe(asset.sha256);
  if(process.env.EXHIBITOS_MODEL_TEST_EVIDENCE){const evidence=process.env.EXHIBITOS_MODEL_TEST_EVIDENCE;await writeFile(join(evidence,'roundtrip.oex'),output);await writeFile(join(evidence,'roundtrip-proof.json'),JSON.stringify({sourceArchiveSHA256:process.env.EXHIBITOS_CURRENT_OEX_SHA256,sourceArtwork:source.id,currentArchiveAdmission:true,nativeProfile:false,isolatedService:true,jobId,exhibitionId:result.exhibitionId,sourceFingerprint:fingerprint(source),resultFingerprint:fingerprint(again),metadata:detail.metadata,roundtripSha256:sha256(output),roundtripBytes:output.length},null,2)+'\n');}
 }finally{await pool.end();}
},120000);
