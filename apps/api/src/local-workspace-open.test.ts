// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';
import {migrate} from '@exhibitos/storage';
import {Auth,digest} from './auth.ts';
import {runNativeModelAdoptionOwner} from './native-model-adoption-owner.ts';
import {openLocalWorkspace,renewLocalWorkspace} from './local-workspace.ts';

const mac=process.platform==='darwin'&&typeof process.getuid==='function'&&process.getuid()>0;
describe.skipIf(!mac)('private local workspace opening',()=>{
 const input={format:1 as const,workspaceId:'10000000-0000-4000-8000-000000000001',tenantId:'10000000-0000-4000-8000-000000000002',principalId:'10000000-0000-4000-8000-000000000003',ownerUid:process.getuid?.()??0,sessionToken:Buffer.alloc(32,1).toString('base64url'),csrfToken:Buffer.alloc(32,2).toString('base64url')};
 it('refuses to create a missing owner in existing-only mode',async()=>{
  const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT * FROM local_workspaces')?{rowCount:0,rows:[]}:{rowCount:0,rows:[]}),release=vi.fn(),pool={connect:async()=>({query,release})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',undefined,{isolation:'read committed',requireExisting:true})).rejects.toMatchObject({code:'LOCAL_WORKSPACE_OWNER_UNAVAILABLE'});
  expect(query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');expect(query.mock.calls.some(call=>/^INSERT|^UPDATE/.test(call[0]))).toBe(false);expect(release).toHaveBeenCalledOnce();
 });
 it('rolls back before owner or session writes if its pre-open schema check fails',async()=>{
  const query=vi.fn(async(sql:string)=>{void sql;return {rowCount:0,rows:[]};}),release=vi.fn(),pool={connect:async()=>({query,release})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',async()=>{throw Error('catalog mismatch');},{isolation:'read committed'})).rejects.toThrow('catalog mismatch');
  expect(query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');expect(query.mock.calls.some(call=>/^INSERT|^UPDATE/.test(call[0]))).toBe(false);expect(release).toHaveBeenCalledOnce();
 });
 it('requires the owner when a pre-open check recognizes an existing catalog',async()=>{
  const query=vi.fn(async(sql:string)=>{void sql;return {rowCount:0,rows:[]};}),release=vi.fn(),pool={connect:async()=>({query,release})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',async()=>({requireExisting:true}),{isolation:'read committed'})).rejects.toMatchObject({code:'LOCAL_WORKSPACE_OWNER_UNAVAILABLE'});
  expect(query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');expect(query.mock.calls.some(call=>/^INSERT|^UPDATE/.test(call[0]))).toBe(false);
 });
 it('rolls back owner and session writes when the owner connection is lost before commit',async()=>{
  let live=true;const query=vi.fn(async(sql:string)=>{if(sql.startsWith('SELECT * FROM local_workspaces'))return {rowCount:0,rows:[]};if(sql.startsWith('SELECT (EXISTS'))return {rowCount:1,rows:[{occupied:false}]};if(sql.startsWith('INSERT INTO auth_sessions'))live=false;return {rowCount:0,rows:[]};}),release=vi.fn(),pool={connect:async()=>({query,release})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',async()=>{}, {isolation:'read committed',beforeCommit:()=>{if(!live)throw Error('NATIVE_OWNER_UNAVAILABLE');}})).rejects.toThrow('NATIVE_OWNER_UNAVAILABLE');
  expect(query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');expect(query.mock.calls.map(call=>call[0])).not.toContain('COMMIT');
 });
 it('awaits an asynchronous owner check and rolls back if it fails',async()=>{
  const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT * FROM local_workspaces')?{rowCount:0,rows:[]} : sql.startsWith('SELECT (EXISTS')?{rowCount:1,rows:[{occupied:false}]}:{rowCount:0,rows:[]}),pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',undefined,{isolation:'read committed',beforeCommit:async()=>{await Promise.resolve();throw Error('OWNER_LOST');}})).rejects.toThrow('OWNER_LOST');
  expect(query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');expect(query.mock.calls.map(call=>call[0])).not.toContain('COMMIT');
 });
 it('rejects retained furnishing claims before owner writes under an exclusive maintenance fence',async()=>{
  const query=vi.fn(async(sql:string)=>sql.includes('workspace_furnishing_intakes')?{rows:[{pending:true}]}:{rows:[]}),pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool;
  await expect(openLocalWorkspace(pool,input,'native',async c=>{await c.query('SELECT pg_advisory_xact_lock(82001)');},{isolation:'read committed',furnishingExclusive:true,beforeCommit:()=>{}})).rejects.toMatchObject({code:'FURNISHING_RECOVERY_UNAVAILABLE'});
  const calls=query.mock.calls.map(call=>call[0]);expect(calls.indexOf('SELECT pg_advisory_xact_lock(82003)')).toBeLessThan(calls.indexOf('SELECT pg_advisory_xact_lock(82002)'));expect(calls.indexOf('SELECT pg_advisory_xact_lock(82002)')).toBeLessThan(calls.indexOf('SELECT pg_advisory_xact_lock(82001)'));expect(calls).toContain('ROLLBACK');expect(calls.some(sql=>/^(INSERT|UPDATE)/.test(sql))).toBe(false);
 });
 it('opens only after an exclusive furnishing fence observes no claims',async()=>{
  const query=vi.fn(async(sql:string)=>sql.includes('workspace_furnishing_intakes')?{rows:[{pending:false}]}:sql.startsWith('SELECT * FROM local_workspaces')?{rowCount:0,rows:[]}:sql.startsWith('SELECT (EXISTS')?{rows:[{occupied:false}]}:{rows:[]}),pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool;
  await openLocalWorkspace(pool,input,'native',async c=>{await c.query('SELECT pg_advisory_xact_lock(82001)');},{isolation:'read committed',furnishingExclusive:true,beforeCommit:()=>{}});
  const calls=query.mock.calls.map(call=>call[0]);expect(calls.findIndex(sql=>sql.includes('workspace_furnishing_intakes'))).toBeLessThan(calls.findIndex(sql=>sql.startsWith('INSERT INTO tenants')));expect(calls).toContain('COMMIT');
 });
 it.skipIf(!process.env.EXHIBITOS_LOCAL_OPERATOR_TEST_DATABASE_URL)('keeps private operator auth through real GUI renewal but refuses disable and revocation',async()=>{
  const pool=new Pool({connectionString:process.env.EXHIBITOS_LOCAL_OPERATOR_TEST_DATABASE_URL});
  try{
   const empty=await pool.query("SELECT to_regclass('public.local_workspaces') AS existing");
   expect(empty.rows[0]?.existing).toBeNull();
   const migrationPath=(directory:string)=>fileURLToPath(new URL('../../../database/'+directory+'/',import.meta.url));
   await migrate(pool,migrationPath('migrations'));
   await migrate(pool,migrationPath('native-oex-normal'),'027_oex_exhibition_provenance.sql');
   await migrate(pool,migrationPath('native-workspace-furnishing'));
   const options={isolation:'read committed',furnishingExclusive:true,issueNativeOperator:true,beforeCommit:()=>{}} as const;
   const initial=await openLocalWorkspace(pool,input,'native',async()=>{},options);
   expect(initial.nativeOperator).toBeDefined();
   const operator=initial.nativeOperator!;
   expect(operator.sessionToken).not.toBe(input.sessionToken);
   const auth=new Auth(pool);
   const request=(value:{sessionToken:string;csrfToken:string})=>auth.requestForNativeWorkspaceMutation(
    value.sessionToken,input.tenantId,value.csrfToken,async(_c,s)=>s,
   );
   await expect(request(input)).resolves.toMatchObject({userId:input.principalId});
   await expect(request(operator)).resolves.toMatchObject({userId:input.principalId,role:'admin'});
   const renewed={...input,previousSessionToken:input.sessionToken,sessionToken:Buffer.alloc(32,3).toString('base64url'),csrfToken:Buffer.alloc(32,4).toString('base64url')};
   await renewLocalWorkspace(pool,renewed,'native');
   await expect(request(input)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
   await expect(request(renewed)).resolves.toMatchObject({userId:input.principalId});
   await expect(request(operator)).resolves.toMatchObject({userId:input.principalId});
   const runStatus=async()=>{
    const controller=new AbortController(),operationId='10000000-0000-4000-8000-000000000004';
    const runtimeGeneration='10000000-0000-4000-8000-000000000005',grantSha256='1'.repeat(64);
    const receive=async()=>Buffer.from(JSON.stringify({version:1,kind:'adoption-status-target',operationId,runtimeGeneration,grantSha256}));
    let reply:unknown;
    const send=async(frame:Uint8Array)=>{reply=JSON.parse(Buffer.from(frame).toString());controller.abort();};
    await runNativeModelAdoptionOwner({
     runtimeGeneration,owner:{workspaceId:input.workspaceId,tenantId:input.tenantId,principalId:input.principalId,...operator},
     auth,imports:{coarseOwner:async()=>({workspaceId:input.workspaceId})} as never,
     cms:{} as never,studio:{} as never,broker:{} as never,blobs:{} as never,
     channel:{receive,send,close:async()=>{},isOpen:()=>true},signal:controller.signal,assertLive:async()=>{},
    });
    return reply;
   };
   await expect(runStatus()).resolves.toMatchObject({kind:'adoption-target-status',outcome:'unresolved'});
   await expect(request({...operator,csrfToken:renewed.csrfToken})).rejects.toMatchObject({code:'CSRF_REJECTED'});
   await pool.query('UPDATE users SET disabled=true WHERE id=$1',[input.principalId]);
   await expect(request(operator)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
   await pool.query('UPDATE users SET disabled=false WHERE id=$1',[input.principalId]);
   await pool.query('UPDATE auth_sessions SET revoked=true WHERE token_hash=$1',[digest(operator.sessionToken)]);
   await expect(request(operator)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
   await expect(runStatus()).resolves.toMatchObject({kind:'adoption-refused'});
   await expect(request(renewed)).resolves.toMatchObject({userId:input.principalId});
  }finally{await pool.end();}
 },15000);

});
