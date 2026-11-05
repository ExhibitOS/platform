// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('holds the backup fence and uses the same connection for every transaction',async()=>{
 const steps:string[]=[],fence={query:vi.fn(async(sql:string)=>{steps.push(sql);return {rows:sql.includes('unlock')?[{unlocked:true}]:[],rowCount:0};}),release:vi.fn()};
 const connect=vi.fn(async()=>fence),pool={connect} as unknown as Pool;
 const service=new WorkspaceMaterialIntakes({} as BlobStore,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{steps.push('owner');}},()=>({valid:true,errors:[]}));
 expect(await service.work(pool)).toBe(false);expect(connect).toHaveBeenCalledOnce();expect(steps[0]).toBe('SELECT pg_advisory_lock_shared(82002)');expect(steps.at(-1)).toBe('SELECT pg_advisory_unlock_shared(82002) AS unlocked');
 expect(steps.findIndex(s=>s==='COMMIT')).toBeLessThan(steps.length-1);expect(fence.release).toHaveBeenCalledWith(false);
});
it('destroys the fenced connection if lock release is not confirmed',async()=>{
 const fence={query:vi.fn(async(sql:string)=>({rows:sql.includes('unlock')?[{unlocked:false}]:[],rowCount:0})),release:vi.fn()},pool={connect:async()=>fence} as unknown as Pool;
 const service=new WorkspaceMaterialIntakes({} as BlobStore,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{}},()=>({valid:true,errors:[]}));
 expect(await service.work(pool)).toBe(false);expect(fence.release).toHaveBeenCalledWith(true);
});
it('finishes a claimed cancellation with one pool slot while a backup is queued',async()=>{
 let claimed=false,finalized=false,locked=false;let resume!:()=>void,notify!:()=>void;const started=new Promise<void>(r=>{notify=r;}),pause=new Promise<void>(r=>{resume=r;});
 const row={id:id(4),phase:'cancelling',declaration:{maps:{}},received:{}};
 const fence={query:vi.fn(async(sql:string)=>{
  if(sql.includes('pg_advisory_lock_shared'))locked=true;
  if(sql.includes('SELECT * FROM workspace_material_intakes')){claimed=true;return {rows:[row],rowCount:1};}
  if(sql.includes("SET phase=CASE")){finalized=true;return {rows:[{id:id(4)}],rowCount:1};}
  if(sql.includes('pg_advisory_unlock_shared')){locked=false;return {rows:[{unlocked:true}],rowCount:1};}
  return {rows:[],rowCount:0};
 }),release:vi.fn()};
 const connect=vi.fn(async()=>{if(connect.mock.calls.length>1)throw Error('single connection pool exhausted');return fence;}),pool={connect} as unknown as Pool;
 const service=new WorkspaceMaterialIntakes({} as BlobStore,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{}},()=>({valid:true,errors:[]}));
 const pending=service.work(pool,{afterClaim:async()=>{notify();await pause;}});await started;expect(claimed).toBe(true);expect(locked).toBe(true);
 // An exclusive backup cannot acquire the fence yet; the worker must finish without another checkout.
 resume();expect(await pending).toBe(true);expect(finalized).toBe(true);expect(locked).toBe(false);expect(connect).toHaveBeenCalledOnce();expect(fence.release).toHaveBeenCalledWith(false);
});
