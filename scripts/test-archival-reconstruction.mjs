// SPDX-License-Identifier: AGPL-3.0-or-later
// Original T11-03 scenario: genuine historical OEX, explicit conversion, retained runtime.
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {fixtureURL,readOex,revisionHash} from '@exhibitos/spec';
import {freezeCanonical,verifyFreezeBundle} from '@exhibitos/studio-contract';
import {migrateLegacyOex} from '../apps/api/dist/archive-migration.js';
import {loadFreezeRuntime} from '../apps/api/dist/freeze.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${name}`);};
const directory=await mkdtemp(`${tmpdir()}/exhibitos-archival-reconstruction-`);
const source=await readFile(fixtureURL('oex/v1/examples/synthetic.oex')),sourceHash=sha(source),old=await readOex(source);
assert.equal(old.manifest.formatVersion,'1.0.0-draft.1');
const migrated=await migrateLegacyOex(source,{createdAt:new Date().toISOString()}),current=await readOex(migrated.bytes);
await check('historical draft.1 converts to draft.2 with exact scene rights provenance and asset bytes',async()=>{
 assert.deepEqual(current.exhibition,old.exhibition);assert.equal(revisionHash(current.exhibition),revisionHash(old.exhibition));
 for(const item of old.manifest.assets){const target=current.manifest.assets.find(x=>x.artifactPath===item.artifactPath);assert(target);assert.deepEqual(current.files.get(target.path),old.files.get(item.path));}
 assert.equal(sha(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),sourceHash);
});
const retained=await loadFreezeRuntime(new URL('../apps/web/dist/',import.meta.url).pathname);
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),publicBytes=publicKey.export({type:'spki',format:'der'}),keyId=sha(publicBytes);
const artifact=JSON.parse(await readFile(new URL('../contracts/artifact.json',import.meta.url)));
const migrations=[];for(const name of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort())migrations.push(`${name}:${sha(await readFile(new URL(`../database/migrations/${name}`,import.meta.url)))}`);
const createdAt=new Date().toISOString(),id=randomUUID(),exhibitionHash=revisionHash(current.exhibition);
// This synthetic operator's key is trusted explicitly. It is not a production account grant.
const manifest={schemaVersion:'1.0.0-draft.1',kind:'exhibition-freeze',id,createdAt,source:{exhibitionId:current.exhibition.id,revision:current.exhibition.revision,etag:`"studio-r${current.exhibition.revision}-${exhibitionHash}"`,exhibitionHash},formats:{oes:'1.0.0-draft.1',oex:'1.0.0-draft.2',specPackage:artifact.packageVersion,specSha256:artifact.sha256,migrations},oex:{bytes:migrated.bytes.length,sha256:sha(migrated.bytes)},runtime:retained.runtime,authority:{origin:'http://127.0.0.1:3000',keyId,publicKey:publicBytes.toString('base64')}};
const signature=value=>sign(null,Buffer.from(freezeCanonical(value)),privateKey).toString('base64');
const grant={schemaVersion:'1.0.0-draft.1',kind:'offline-display-grant',freezeId:id,manifestSha256:sha(freezeCanonical(manifest)),tenantId:randomUUID(),subjectId:randomUUID(),origin:manifest.authority.origin,keyId,issuedAt:createdAt,expiresAt:new Date(Date.parse(createdAt)+300000).toISOString()};
const bundle={schemaVersion:'1.0.0-draft.1',kind:'exhibitos-offline',manifest,signature:signature(manifest),authorization:{grant,signature:signature(grant)},oex:Buffer.from(migrated.bytes).toString('base64'),runtimeFiles:[...retained.files].map(([path,data])=>({path,data:data.toString('base64')}))};
await check('signed reconstructed package verifies every retained file and refuses untrusted authority',async()=>{
 await assert.rejects(verifyFreezeBundle(Buffer.from(JSON.stringify(bundle)),{trustedKeys:[]}));
 const verified=await verifyFreezeBundle(Buffer.from(JSON.stringify(bundle)),{trustedKeys:[keyId]});assert.deepEqual((await readOex(verified.oexBytes)).exhibition,old.exhibition);
});
const file=`${directory}/historical.oef`,serverFile=`${directory}/offline-server.mjs`;
await writeFile(file,JSON.stringify(bundle),{mode:0o600});await writeFile(serverFile,retained.files.get('offline-server.mjs'));
const child=spawn(process.execPath,[serverFile,file,'--trust-key',keyId,'--port','0'],{cwd:directory,stdio:['ignore','pipe','pipe']});
const terminal=new Promise(resolve=>child.once('exit',resolve));let output='',errors='';child.stderr.on('data',x=>{errors+=x;});
let browser;const requests=[],pageErrors=[];
try{
 const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Retained server timeout: ${errors}`)),15000);child.stdout.on('data',x=>{output+=x;const match=output.match(/ExhibitOS offline (http:\/\/127\.0\.0\.1:\d+)\/offline/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Retained server exited ${code}: ${errors}`));});});
 await check('independent directory serves exact retained files and package without an API',async()=>{
  for(const descriptor of manifest.runtime.files){const response=await fetch(`${origin}/${descriptor.path}`);assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),descriptor.sha256);}
  assert.equal((await fetch(`${origin}/api/v1/auth/session`)).status,404);
  assert.deepEqual(await (await fetch(`${origin}/offline-package`)).json(),bundle);
 });
 browser=await chromium.launch();const page=await browser.newPage();page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>pageErrors.push(e.message));
 await check('actual retained browser reconstructs historical exhibition and GLB PNG details offline',async()=>{
  await page.goto(`${origin}/offline`);await page.getByLabel('운영자가 신뢰 키를 확인한 로컬 오프라인 서버',{exact:true}).check();
  await page.getByRole('button',{name:'표시 계정 및 신뢰 키 준비',exact:true}).click();
  await expect(page.getByRole('button',{name:'로컬 서명 패키지 준비',exact:true})).toBeEnabled();await page.getByRole('button',{name:'로컬 서명 패키지 준비',exact:true}).click();
  await page.getByRole('button',{name:'고정 전시 열기',exact:true}).click();
  await expect(page.getByRole('heading',{name:old.exhibition.title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'3D 관람 시작',exact:true}).click();
  for(const artwork of old.exhibition.artworks){const title=artwork.metadata.title,buttons=page.getByRole('button',{name:`${title} 상세 보기`,exact:true});assert.equal(await buttons.count(),old.exhibition.placements.filter(p=>p.artworkRevisionId===artwork.revisionId).length);for(let i=0;i<await buttons.count();i++){await buttons.nth(i).click();await expect(page.getByRole('dialog').locator('canvas')).toHaveCount(1,{timeout:30000});await page.keyboard.press('Escape');}}
  assert.deepEqual(pageErrors,[]);assert(requests.every(url=>new URL(url).origin===origin));assert(!requests.some(url=>new URL(url).pathname.startsWith('/api/')));
 });
}finally{await browser?.close();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await terminal;}
assert.equal(sha(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),sourceHash);
const report={status:'PASS',checkedAt:new Date().toISOString(),checks,migration:migrated.receipt,runtime:manifest.runtime,requests,pageErrors,limits:['Synthetic explicit operator trust, not production account authorization or OCI deployment.','Historical original and signed freezes are never rewritten.'],directory};
await writeFile(`${directory}/result.json`,JSON.stringify(report,null,2)+'\n');console.log(`REPORT ${directory}/result.json`);
