// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual PostgreSQL auth/advisory-lock regression. The immutable proof row is
// supplied by the existing fixture; this is not a native-profile/import test.
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool,type PoolClient} from 'pg';
import {expect,it} from 'vitest';
import {freezeCanonical} from '@exhibitos/studio-contract';
import type {Session} from './auth.ts';
import {lockWorkspaceOexSession,verifyWorkspaceOexCommittedOnClient} from './workspace-oex-terminal-committed.ts';
const f=JSON.parse(await readFile(new URL('../test-fixtures/workspace-oex-terminal-native-v1.json',import.meta.url),'utf8'));
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
it.skipIf(!process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL)('retains actual auth locks and verifies on the same PG client with an exclusive advisory waiter already queued',async()=>{
 const pool=new Pool({connectionString:process.env.EXHIBITOS_MODEL_TEST_DATABASE_URL,max:3,connectionTimeoutMillis:3000,statement_timeout:3000}),c=await pool.connect(),waiter=await pool.connect(),schema='cleanup_'+randomUUID().replaceAll('-','');
 const s={id:randomUUID(),tenantId:f.scope.tenantId,userId:f.scope.principalId,role:'artist'} as Session;
 let pending:Promise<unknown>|undefined;
 try{
  await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET search_path=${schema},public`);await waiter.query(`SET search_path=${schema},public`);
  await c.query('CREATE TABLE tenants(id uuid PRIMARY KEY,deleted_at timestamptz);CREATE TABLE users(id uuid PRIMARY KEY,disabled boolean);CREATE TABLE memberships(tenant_id uuid,user_id uuid,role text);CREATE TABLE auth_sessions(id uuid PRIMARY KEY,tenant_id uuid,user_id uuid,revoked boolean,expires_at timestamptz)');
  await c.query('INSERT INTO tenants VALUES($1,NULL)',[s.tenantId]);await c.query('INSERT INTO users VALUES($1,false)',[s.userId]);await c.query("INSERT INTO memberships VALUES($1,$2,'artist')",[s.tenantId,s.userId]);await c.query("INSERT INTO auth_sessions VALUES($1,$2,$3,false,clock_timestamp()+interval '1 hour')",[s.id,s.tenantId,s.userId]);
  const waiterPid=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const waitForBlocked=async()=>{for(let i=0;i<100;i++){if((await c.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted',[waiterPid])).rowCount)return;await delay(5);}throw Error('waiter did not reach the intended lock boundary');};
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await lockWorkspaceOexSession(c,s);
  await waiter.query('BEGIN');pending=waiter.query('SELECT pg_advisory_xact_lock(82003)');void pending.catch(()=>{});await waitForBlocked();
  const save={exhibitionId:f.result.exhibitionId,etag:f.saved.etag,requestId:randomUUID()},payload=createHash('sha256').update(freezeCanonical({method:'PUT',id:save.exhibitionId,match:f.result.etag,input:{draft:f.result.draft,requestId:save.requestId}})).digest('hex');
  const proofRow={proof_bytes:Buffer.from(f.proofUtf8),result_bytes:Buffer.from(f.resultUtf8),result_sha256:f.proof.resultSha256,claim_sha256:'b'.repeat(64),payload_manifest_sha256:'c'.repeat(64),source_database_system_id:'1',source_database_oid:'2',job_result:f.result,initial_snapshot:f.result.draft,saved_snapshot:f.saved.draft,save_payload:payload,save_response:f.saved};
  const sql:string[]=[],sameClient={query:async(text:string,args?:unknown[])=>{sql.push(text);if(text.includes('FROM workspace_oex_import_terminal_proof'))return {rows:[proofRow],rowCount:1};return c.query(text,args);}} as PoolClient;
  const owner={workspaceId:f.scope.workspaceId,tenantId:s.tenantId,principalId:s.userId,assertDatabase:async()=>{},assertImportCatalog:async()=>{},assertRecord:async()=>{}};
  await verifyWorkspaceOexCommittedOnClient(sameClient,s,owner,{scope:f.scope,proofBytes:Buffer.from(f.proofUtf8),resultBytes:Buffer.from(f.resultUtf8),claimSha256:'b'.repeat(64),save});
  expect(sql.some(text=>text.includes('pg_advisory'))).toBe(false);expect(sql.filter(text=>text.includes('FOR SHARE OF a,u,m,t'))).toHaveLength(2);
  await c.query('COMMIT');await pending;pending=undefined;await waiter.query('ROLLBACK');
  // A real revoker cannot cross the destructive transaction's held auth lock.
  await c.query('BEGIN');await lockWorkspaceOexSession(c,s);
  pending=waiter.query('UPDATE auth_sessions SET revoked=true WHERE id=$1',[s.id]);void pending.catch(()=>{});await waitForBlocked();await lockWorkspaceOexSession(c,s);
  await c.query('COMMIT');await pending;pending=undefined;await c.query('BEGIN');await expect(lockWorkspaceOexSession(c,s)).rejects.toThrow('OEX_TERMINAL_COMMITTED_INVALID');await c.query('ROLLBACK');
  // Expiry still advances despite retained row locks, and must be rechecked.
  await c.query("UPDATE auth_sessions SET revoked=false,expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",[s.id]);await c.query('BEGIN');await lockWorkspaceOexSession(c,s);await delay(200);await expect(lockWorkspaceOexSession(c,s)).rejects.toThrow('OEX_TERMINAL_COMMITTED_INVALID');await c.query('ROLLBACK');
 }finally{
  await c.query('ROLLBACK').catch(()=>{});if(pending)await pending.catch(()=>{});await waiter.query('ROLLBACK').catch(()=>{});await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});c.release();waiter.release();await pool.end();
 }
},15000);
