// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {Pool} from 'pg';
import {migrate} from '@exhibitos/storage';
import {Auth} from './auth.ts';
import {NativeDetailOperations,type NativeDetailScope} from './native-detail-static-export.ts';

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

it.skipIf(!process.env.NATIVE_DETAIL_TEST_PG)('disconnect cancels the admitted read even with an exclusive writer and shared close queued',async()=>{
 const pool=new Pool({connectionString:process.env.NATIVE_DETAIL_TEST_PG,max:5}),tenantId=randomUUID(),userId=randomUUID(),sessionId=randomUUID(),token='a'.repeat(43),csrf='detail-csrf',sha=(v:string)=>createHash('sha256').update(v).digest('hex');
 try{
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'isolated']);await pool.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,randomUUID()]);await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[sessionId,sha(token),sha(csrf),csrf,tenantId,userId]);
  const auth=new Auth(pool),registry=new NativeDetailOperations(),s:NativeDetailScope={runtimeGeneration:randomUUID(),workspaceId:randomUUID(),tenantId,principalId:userId,sessionId,publicationId:randomUUID(),revisionSha256:'a'.repeat(64),jobId:randomUUID()};
  await registry.run(s,'prepare',async()=>{},async()=>{});
  const entered=deferred(),cleanup=deferred(),writerEntered=deferred(),releaseWriter=deferred();
  const read=registry.run(s,'bytes',signal=>auth.requestForNativeDetailRead(token,tenantId,csrf,async(c)=>{expect((await c.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('read committed');entered.release();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));signal.throwIfAborted();}),async()=>{await cleanup.promise;});
  await entered.promise;
  const writer=auth.requestForNativeWorkspaceMutation(token,tenantId,csrf,async()=>{writerEntered.release();await releaseWriter.promise;});
  let waiting=false;for(let i=0;i<100;i++){const rows=await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(82003)%' LIMIT 1");if(rows.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}expect(waiting).toBe(true);
  const close=auth.requestForNativeDetailRead(token,tenantId,csrf,async()=>{registry.close(s);});
  // The admitted request's own disconnect is independent of the queued DB control path.
  registry.close(s);expect(registry.status(s)).toBe('pending');await writerEntered.promise;expect(registry.status(s)).toBe('pending');
  releaseWriter.release();await writer;await close;cleanup.release();await expect(read).rejects.toThrow();expect(registry.status(s)).toBe('settled-failure');
 }finally{await pool.end();}
},120000);
