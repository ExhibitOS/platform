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
});
