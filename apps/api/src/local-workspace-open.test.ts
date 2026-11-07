// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {openLocalWorkspace} from './local-workspace.ts';

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
});
