// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only against a separately owned disposable native-session database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {migrate} from '../packages/storage/dist/index.js';
import {openLocalWorkspace,renewLocalWorkspace,validateLocalWorkspaceRenewal} from '../apps/api/dist/local-workspace.js';
import {digest} from '../apps/api/dist/auth.js';
const url=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/exhibitos_native_session_test_'))throw Error('DISPOSABLE_SESSION_DATABASE_REQUIRED');
const pool=new Pool({connectionString:url.href,max:4,statement_timeout:10000});
const token=()=>randomBytes(32).toString('base64url');
const workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:token(),csrfToken:token()};
await migrate(pool,new URL('../database/migrations/',import.meta.url).pathname);
await openLocalWorkspace(pool,workspace,'native');
const seed=async()=>{const previousSessionToken=token();await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 minute')",[randomUUID(),digest(previousSessionToken),digest(workspace.csrfToken),workspace.csrfToken,workspace.tenantId,workspace.principalId]);return {...workspace,previousSessionToken,sessionToken:token(),csrfToken:token()};};
const snapshot=async()=>JSON.stringify((await pool.query('SELECT id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at,revoked FROM auth_sessions ORDER BY id')).rows);
try{
 await test('expiry-only native renewal creates a fresh fixed-TTL session, revokes only its predecessor and preserves authoring data',async()=>{
  await pool.query("INSERT INTO exhibitions(tenant_id,id,metadata) VALUES($1,$2,$3)",[workspace.tenantId,randomUUID(),{title:'Preserved synthetic draft',raw:'unsaved input is not written by renewal'}]);
  const before=(await pool.query('SELECT id,metadata FROM exhibitions ORDER BY id')).rows,request=await seed(),count=Number((await pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count);
  assert.deepEqual(await renewLocalWorkspace(pool,request,'native'),{workspaceId:workspace.workspaceId,tenantId:workspace.tenantId,principalId:workspace.principalId});
  assert.equal((await pool.query('SELECT revoked FROM auth_sessions WHERE token_hash=$1',[digest(request.previousSessionToken)])).rows[0].revoked,true);
  const next=(await pool.query("SELECT tenant_id,user_id,csrf_hash,csrf_token,expires_at>now()+interval '7 hours 59 minutes' AS ordinary_ttl,expires_at<=now()+interval '8 hours' AS bounded_ttl FROM auth_sessions WHERE token_hash=$1 AND NOT revoked",[digest(request.sessionToken)])).rows[0];
  assert.equal(next.tenant_id,workspace.tenantId);assert.equal(next.user_id,workspace.principalId);assert.equal(next.csrf_hash,digest(request.csrfToken));assert.equal(next.csrf_token,request.csrfToken);assert.equal(next.ordinary_ttl,true);assert.equal(next.bounded_ttl,true);
  assert.equal(Number((await pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count),count+1);assert.equal((await pool.query('SELECT revoked FROM auth_sessions WHERE token_hash=$1',[digest(workspace.sessionToken)])).rows[0].revoked,false);assert.deepEqual((await pool.query('SELECT id,metadata FROM exhibitions ORDER BY id')).rows,before);
 });
 await test('revoked, missing, foreign scope, changed owner and inactive authority refuse with zero session writes',async()=>{
  const foreign={tenant:randomUUID(),principal:randomUUID(),token:token()};
  await pool.query("INSERT INTO tenants(id,name) VALUES($1,'Foreign synthetic tenant')",[foreign.tenant]);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[foreign.principal,'synthetic-'+foreign.principal]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[foreign.tenant,foreign.principal]);await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 minute')",[randomUUID(),digest(foreign.token),digest(workspace.csrfToken),workspace.csrfToken,foreign.tenant,foreign.principal]);
  for(const kind of ['revoked','missing','foreignSession','tenant','principal','workspace','uid','disabled','role','deleted']){
   const request=await seed();
   if(kind==='revoked')await pool.query('UPDATE auth_sessions SET revoked=true WHERE token_hash=$1',[digest(request.previousSessionToken)]);
   if(kind==='missing')request.previousSessionToken=token();if(kind==='foreignSession')request.previousSessionToken=foreign.token;if(kind==='tenant')request.tenantId=randomUUID();if(kind==='principal')request.principalId=randomUUID();if(kind==='workspace')request.workspaceId=randomUUID();if(kind==='uid')request.ownerUid++;
   if(kind==='disabled')await pool.query('UPDATE users SET disabled=true WHERE id=$1',[workspace.principalId]);
   if(kind==='role')await pool.query("UPDATE memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",[workspace.tenantId,workspace.principalId]);
   if(kind==='deleted')await pool.query('UPDATE tenants SET deleted_at=now() WHERE id=$1',[workspace.tenantId]);
   const before=await snapshot();await assert.rejects(renewLocalWorkspace(pool,request,'native'));assert.equal(await snapshot(),before);
   await pool.query('UPDATE users SET disabled=false WHERE id=$1',[workspace.principalId]);await pool.query("UPDATE memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",[workspace.tenantId,workspace.principalId]);await pool.query('UPDATE tenants SET deleted_at=NULL WHERE id=$1',[workspace.tenantId]);
  }
 });
 await test('concurrent rotation is single-use, replay cannot revive old authority, and insert failure rolls back predecessor revocation',async()=>{
  const first=await seed(),second={...first,sessionToken:token(),csrfToken:token()},count=Number((await pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count);
  const results=await Promise.allSettled([renewLocalWorkspace(pool,first,'native'),renewLocalWorkspace(pool,second,'native')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(Number((await pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count),count+1);
  const before=await snapshot();await assert.rejects(renewLocalWorkspace(pool,{...first,sessionToken:token(),csrfToken:token()},'native'));assert.equal(await snapshot(),before);
  const collision=await seed();collision.sessionToken=workspace.sessionToken;const preserved=await snapshot();await assert.rejects(renewLocalWorkspace(pool,collision,'native'));assert.equal(await snapshot(),preserved);
 });
 await test('closed canonical private input and fixed entry refuse extra args/fields without disclosing credentials',async()=>{
  const request=await seed();for(const edit of [v=>v.extra=true,v=>v.sessionToken=v.previousSessionToken,v=>v.csrfToken=v.previousSessionToken,v=>v.previousSessionToken='x'.repeat(43)]){const bad={...request};edit(bad);assert.throws(()=>validateLocalWorkspaceRenewal(bad,'native'));}
  const before=await snapshot(),entry=new URL('./native-workspace-session.mjs',import.meta.url).pathname;
  for(const extra of [[],['forbidden']]){
   const result=spawnSync(process.execPath,[entry,...extra],{input:JSON.stringify({...request,sessionToken:request.previousSessionToken}),encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_AUTHORING_MODE:'personal',TENANT_ID:workspace.tenantId,DATABASE_URL:url.href}});
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'LOCAL_WORKSPACE_RENEWAL_FAILED\n');assert.equal(await snapshot(),before);
  }
  const success=spawnSync(process.execPath,[entry],{input:JSON.stringify(request),encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_AUTHORING_MODE:'personal',TENANT_ID:workspace.tenantId,DATABASE_URL:url.href}});
  assert.equal(success.status,0);assert.equal(success.stderr,'');assert.deepEqual(JSON.parse(success.stdout),{workspaceId:workspace.workspaceId,tenantId:workspace.tenantId,principalId:workspace.principalId});assert.equal((await pool.query('SELECT revoked FROM auth_sessions WHERE token_hash=$1',[digest(request.previousSessionToken)])).rows[0].revoked,true);
 });
}finally{await pool.end();}
