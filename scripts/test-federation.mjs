// SPDX-License-Identifier: AGPL-3.0-or-later
// Real HTTP + independent PG pools. Fixture creation/migrations are owned by
// the existing admission-controlled integration harness, never production data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {transaction} from '../packages/storage/dist/index.js';
import {Federation,FEDERATION_PATH} from '../apps/api/src/federation.ts';

export async function runFederationScenario({poolA,poolB,publicationIdA,publicationIdB,approvedA,approvedB,withdrawA,openPublication}){
 const key=()=>generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).toString();
 const a=new Federation(poolA,{origin:'https://alpha.example.com',privateKey:key()}),b=new Federation(poolB,{origin:'https://beta.example.com',privateKey:key()});
 const servers=[];const addresses=new Map();
 async function serve(f,pool,approved){
  const server=createServer((req,res)=>{void (async()=>{
   if(req.method!=='GET'||req.url!==FEDERATION_PATH){res.writeHead(404);res.end();return;}
   const envelope=await transaction(pool,c=>f.discovery(c,approved));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(envelope));
  })().catch(()=>{res.writeHead(503);res.end();});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});servers.push(server);addresses.set(f.origin,`http://127.0.0.1:${server.address().port}`);
 }
 const transport=async(origin)=>{const address=addresses.get(origin);if(!address)throw Error('test origin unavailable');const response=await fetch(address+FEDERATION_PATH,{redirect:'error',signal:AbortSignal.timeout(5000)});if(response.status!==200)throw Error('test discovery unavailable');return response.json();};
 const cooldown=async pool=>pool.query("UPDATE federation_peers SET last_attempt=now()-interval '61 seconds'");
 const directory=(f,pool)=>transaction(pool,c=>f.directory(c));
 try{
  await serve(a,poolA,approvedA);await serve(b,poolB,approvedB);
  await transaction(poolA,async c=>{await a.listing(c,publicationIdA,true);await a.peer(c,b.origin,b.publicKey,'trusted');});
  await transaction(poolB,async c=>{await b.listing(c,publicationIdB,true);await b.peer(c,a.origin,a.publicKey,'trusted');});
  assert.equal((await b.sync(a.origin,transport)).state,'synced');assert.equal((await a.sync(b.origin,transport)).state,'synced');
  assert((await directory(b,poolB)).items.some(i=>i.publication_id===publicationIdA));
  assert((await directory(a,poolA)).items.some(i=>i.publication_id===publicationIdB));
  const found=(await directory(b,poolB)).items.find(i=>i.publication_id===publicationIdA);
  assert.equal(await openPublication(found.url),200);
  // The existing fixture's actual anonymous viewer HTTP check is independent of cache.
  await cooldown(poolB);await assert.rejects(b.sync(a.origin,async()=>({payload:'{}',signature:'0'.repeat(128)})),/FEDERATION_SIGNATURE/);
  assert((await directory(b,poolB)).items.some(i=>i.publication_id===publicationIdA));
  await cooldown(poolB);await b.sync(a.origin,async()=>{throw Error('synthetic offline');});
  assert((await directory(b,poolB)).items.some(i=>i.publication_id===publicationIdA));
  await transaction(poolB,c=>b.peer(c,a.origin,a.publicKey,'blocked'));
  assert.equal((await directory(b,poolB)).items.length,0);await assert.rejects(b.sync(a.origin,transport),/FEDERATION_BLOCKED/);
  await transaction(poolB,c=>b.peer(c,a.origin,a.publicKey,'trusted'));await cooldown(poolB);await b.sync(a.origin,transport);
  await withdrawA();await cooldown(poolB);await b.sync(a.origin,transport);
  assert(!(await directory(b,poolB)).items.some(i=>i.publication_id===publicationIdA));
  return {twoActualHttpListeners:true,persistentIndependentDirectories:true,discoverBothDirections:true,openOriginalUrl:true,forgeryRefused:true,blockedPeerRemoved:true,offlineVerifiedCachePreserved:true,unpublishSynchronized:true,publicInternetTls:false};
 }finally{await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));}
}
// No direct execution fallback: the admission-controlled caller must provide
// actual published fixtures/current-rights hooks in independent disposable DBs.

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)throw Error('Run runFederationScenario through the admitted disposable publication fixture harness; direct invocation is not a test PASS');
