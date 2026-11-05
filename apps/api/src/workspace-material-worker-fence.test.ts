// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('holds the backup inventory fence until the worker transaction completes',async()=>{
 const steps:string[]=[],fence={query:vi.fn(async(sql:string)=>{steps.push(sql);return {rows:[{unlocked:true}],rowCount:1};}),release:vi.fn()};
 const client={query:vi.fn(async(sql:string)=>{steps.push(sql);return {rows:[],rowCount:0};}),release:vi.fn()};let n=0;
 const pool={connect:async()=>++n===1?fence:client} as unknown as Pool;
 const service=new WorkspaceMaterialIntakes({} as BlobStore,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{steps.push('owner');}},()=>({valid:true,errors:[]}));
 expect(await service.work(pool)).toBe(false);expect(steps[0]).toBe('SELECT pg_advisory_lock_shared(82002)');expect(steps.at(-1)).toBe('SELECT pg_advisory_unlock_shared(82002) AS unlocked');
 expect(steps.findIndex(s=>s==='COMMIT')).toBeLessThan(steps.length-1);expect(fence.release).toHaveBeenCalledWith(false);
});
it('destroys the fenced connection if lock release is not confirmed',async()=>{
 const fence={query:vi.fn(async(sql:string)=>({rows:[{unlocked:!sql.includes('unlock')}],rowCount:1})),release:vi.fn()},client={query:vi.fn(async()=>({rows:[],rowCount:0})),release:vi.fn()};let n=0;
 const pool={connect:async()=>++n===1?fence:client} as unknown as Pool;
 const service=new WorkspaceMaterialIntakes({} as BlobStore,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{}},()=>({valid:true,errors:[]}));
 expect(await service.work(pool)).toBe(false);expect(fence.release).toHaveBeenCalledWith(true);
});
