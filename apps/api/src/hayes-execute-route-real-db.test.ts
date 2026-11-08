// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable DB and synthetic owner channel; does not claim native execution.
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {expect,it} from 'vitest';
import {FileBlobStore,migrate,transaction} from '@exhibitos/storage';
import {Auth,digest} from './auth.ts';
import {buildApp} from './app.ts';
import {bindNativeOexWorkspace} from './native-oex-provenance.ts';
import {bindHayesOriginalContext,bindHayesDispositionContext,bindHayesReleaseContext} from './hayes-original-attempt.ts';
import {createNativeHayesCaller} from './native-hayes-caller.ts';

it.skipIf(!process.env.HAYES_EXECUTE_TEST_PG)('exposes execution only to the authenticated selected workspace',async()=>{
 const pool=new Pool({connectionString:process.env.HAYES_EXECUTE_TEST_PG}),root=await realpath(await mkdtemp(join(tmpdir(),'hayes-execute-route-'))),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),token=randomBytes(32).toString('base64url'),csrf='synthetic-csrf';
 try{
  for(const dir of ['migrations','native-oex-normal','native-oex-workspace-import'])await migrate(pool,new URL(`../../../database/${dir}/`,import.meta.url).pathname);
  for(const [dir,name,hash] of [['native-hayes-original','042_hayes_original_attempt.sql','074de4171572039f2f400d49d07aff8a3ec83ec222c1684cbc5452c6cc8b3ece'],['native-hayes-disposition','043_hayes_output_stage.sql','d526e19e77161534c21fbe0f3a09d23651b52d6375889bcd680cc6770fed9e39'],['native-hayes-release','044_hayes_native_release.sql','83a4f49ea7e2a114494166c590a179eb40f19a7379b887871f81c307a0b038ca']]){await pool.query(await readFile(new URL(`../../../database/${dir}/${name}`,import.meta.url),'utf8'));await pool.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'test']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);await pool.query('INSERT INTO local_workspaces(id,tenant_id,user_id,mac_uid) VALUES($1,$2,$3,$4)',[workspaceId,tenantId,userId,process.getuid!()]);await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[randomUUID(),digest(token),digest(csrf),csrf,tenantId,userId]);
  const owner=await transaction(pool,c=>bindNativeOexWorkspace(c,{workspaceId,tenantId,principalId:userId,ownerUid:process.getuid!(),blobRoot:root,workspaceImport:true}));await transaction(pool,async c=>{await bindHayesOriginalContext(c,owner);await bindHayesDispositionContext(c,owner);await bindHayesReleaseContext(c,owner);});
  const blobs=new FileBlobStore(root);let open=true;const channel={isOpen:()=>open,close:async()=>{open=false;},send:async()=>{},receive:async()=>{throw Error('unused');}},caller=createNativeHayesCaller({owner,auth:new Auth(pool),blobs,channel,runtimeGeneration:randomUUID(),nativeOwnerId:randomUUID(),runtimeManifestSha256:'a'.repeat(64),signal:new AbortController().signal,assertLive:async()=>{}});
  const app=buildApp({pool,blobs,nativeOexWorkspace:owner,nativeHayesCaller:caller,runtimeAvailable:()=>true,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}}),headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},path=`/api/v1/tenants/${tenantId}/imports/native-hayes-original/${randomUUID()}/execute`,body={artworkId:randomUUID(),artworkRevision:1};
  try{
   expect((await app.inject({method:'POST',url:path,headers:{...headers,origin:'http://evil.example'},payload:body})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url:path,headers:{...headers,cookie:'exhibitos_local_session=invalid'},payload:body})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:path,headers:{...headers,'x-csrf-token':'wrong'},payload:body})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url:path,headers,payload:{...body,leaseId:randomUUID()}})).statusCode).toBe(400);
   expect((await app.inject({method:'POST',url:path.replace(tenantId,randomUUID()),headers,payload:body})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url:path,headers,payload:body})).statusCode).toBe(409);expect(open).toBe(false);
  }finally{await app.close();await caller.close();}
 }finally{await pool.end();await rm(root,{recursive:true,force:true});}
},30000);
