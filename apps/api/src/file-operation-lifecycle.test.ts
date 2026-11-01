// SPDX-License-Identifier: AGPL-3.0-or-later
import {EventEmitter} from 'node:events';
import {expect,it} from 'vitest';
import type {Pool} from 'pg';
import {FileOperationLifecycle,type FileOperationHooks,type FileOperationIdentity} from './file-operation-lifecycle.ts';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity=():FileOperationIdentity=>({operation:'oex-import',tenantId:id(1),resourceId:id(2),attemptId:id(3),generation:id(4)});
function fixture(){
 const calls:string[]=[],keys:string[]=[],client=new EventEmitter() as EventEmitter&{query:(sql:string,params?:string[])=>Promise<unknown>;release:(destroy?:boolean)=>void};
 let commits=0,uncertain=false;
 client.query=async(sql,params)=>{calls.push(sql);if(sql.includes('pg_try_advisory_lock'))keys.push(params![0]!);if(sql==='COMMIT'&&++commits===2&&uncertain)throw Error('connection lost');return {rows:sql.includes('pg_try_advisory_lock')?[{locked:true}]:sql.includes('pg_advisory_unlock')?[{unlocked:true}]:[],rowCount:1};};
 client.release=destroy=>{calls.push(destroy?'destroy':'release');};
 const pool={options:{max:1,connectionTimeoutMillis:1000},connect:async()=>client} as unknown as Pool;
 const hooks:FileOperationHooks<string,string>={claimPersistent:async()=>{calls.push('persistent-claim');},claim:async()=>{calls.push('claim');},prepare:async()=>{calls.push('prepare');return 'prepared';},confirmDrained:async()=>{calls.push('drain');},verifyPersistentClaim:async()=>{calls.push('persistent-check');},checkFinal:async()=>{calls.push('check');},finalize:async(_c,_i,p)=>{calls.push('finalize');return p;},checkBeforeCommit:async()=>{calls.push('last-check');}};
 return {calls,keys,client,pool,hooks,uncertain:()=>{uncertain=true;}};
}
it('owns both short transactions and holds no global lock during preparation',async()=>{
 const f=fixture(),owner=new FileOperationLifecycle(f.pool,1,1000);
 expect(await owner.runOperation(identity(),f.hooks,new AbortController().signal)).toBe('prepared');
 expect(f.calls.filter(x=>x==='BEGIN')).toHaveLength(2);expect(f.calls.filter(x=>x==='COMMIT')).toHaveLength(2);
 expect(f.calls.indexOf('persistent-claim')).toBeLessThan(f.calls.indexOf('BEGIN'));
 expect(f.calls.indexOf('prepare')).toBeLessThan(f.calls.indexOf('drain'));
 expect(f.calls.indexOf('claim')).toBeLessThan(f.calls.indexOf('COMMIT'));
 expect(f.calls.indexOf('COMMIT')).toBeLessThan(f.calls.indexOf('prepare'));
 expect(f.calls.indexOf('drain')).toBeLessThan(f.calls.lastIndexOf('SELECT pg_advisory_xact_lock_shared(82003)'));
 expect(f.calls.indexOf('drain')).toBeLessThan(f.calls.indexOf('persistent-check'));expect(f.calls.indexOf('persistent-check')).toBeLessThan(f.calls.lastIndexOf('BEGIN'));
 expect(f.calls.lastIndexOf('SELECT pg_advisory_xact_lock_shared(82003)')).toBeLessThan(f.calls.lastIndexOf('SELECT pg_advisory_xact_lock_shared(82002)'));
 expect(f.calls.indexOf('last-check')).toBeLessThan(f.calls.lastIndexOf('COMMIT'));expect(f.calls.at(-1)).toBe('release');
});
it('never starts a transaction or work if the persistent claim cannot be established',async()=>{
 const f=fixture();f.hooks.claimPersistent=async()=>{throw Error('CLAIM_UNCERTAIN');};await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('CLAIM_UNCERTAIN');expect(f.calls).not.toContain('BEGIN');expect(f.calls).not.toContain('prepare');expect(f.calls.at(-1)).toBe('release');
});
it('never finalizes if the persistent claim cannot be revalidated',async()=>{
 const f=fixture();f.hooks.verifyPersistentClaim=async()=>{throw Error('CLAIM_LOST');};await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('CLAIM_LOST');expect(f.calls).not.toContain('finalize');expect(f.calls.filter(x=>x==='COMMIT')).toHaveLength(1);
});
it('never finalizes when actual drain cannot be established',async()=>{
 const f=fixture();f.hooks.confirmDrained=async()=>{throw Error('DRAIN_UNCONFIRMED');};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('DRAIN_UNCONFIRMED');
 expect(f.calls).toContain('claim');expect(f.calls).not.toContain('finalize');expect(f.calls.filter(x=>x==='COMMIT')).toHaveLength(1);
});
it('destroys the session and retains uncertain outcome when final COMMIT fails',async()=>{
 const f=fixture();f.uncertain();
 f.hooks.afterCommit=async()=>{f.calls.push('after-commit');};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('FILE_OPERATION_COMMIT_UNCERTAIN');
 expect(f.calls).not.toContain('after-commit');expect(f.calls).not.toContain('ROLLBACK');expect(f.calls).not.toContain('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked');expect(f.calls.at(-1)).toBe('destroy');
});
it('runs the continuation after known commit and before unlocking, and reports its failure separately',async()=>{
 const f=fixture();f.hooks.afterCommit=async()=>{f.calls.push('after-commit');throw Error('save incomplete');};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('FILE_OPERATION_POSTCOMMIT_FAILED');
 expect(f.calls.lastIndexOf('COMMIT')).toBeLessThan(f.calls.indexOf('after-commit'));expect(f.calls.indexOf('after-commit')).toBeLessThan(f.calls.indexOf('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked'));expect(f.calls).not.toContain('ROLLBACK');
});
it('rejects overload before acquiring another connection',async()=>{
 const f=fixture();let finish!:()=>void;const waiting=new Promise<void>(resolve=>{finish=resolve;});
 f.hooks.prepare=async()=>{await waiting;return 'prepared';};const owner=new FileOperationLifecycle(f.pool,1,1000);
 const first=owner.runOperation(identity(),f.hooks,new AbortController().signal);
 await expect(owner.runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('FILE_OPERATION_BUSY');finish();await first;
});
it('uses the same resource lock for UUID case and different operation kinds',async()=>{
 const f=fixture(),owner=new FileOperationLifecycle(f.pool,1,1000);
 const lower={...identity(),tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resourceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
 await owner.runOperation(lower,f.hooks,new AbortController().signal);
 await owner.runOperation({...lower,operation:'publication',tenantId:lower.tenantId.toUpperCase(),resourceId:lower.resourceId.toUpperCase()},f.hooks,new AbortController().signal);
 expect(f.keys).toHaveLength(2);expect(f.keys[0]).toBe(f.keys[1]);
});
it('checks active before finalization and terminal outcome before commit',async()=>{
 const f=fixture();let state='active';
 f.hooks.checkFinal=async()=>{expect(state).toBe('active');};
 f.hooks.finalize=async()=>{state='terminal';return 'done';};
 f.hooks.checkBeforeCommit=async()=>{expect(state).toBe('terminal');};
 expect(await new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).toBe('done');
});
it('rolls back if cancellation arrives before final COMMIT',async()=>{
 const f=fixture(),abort=new AbortController();
 f.hooks.checkBeforeCommit=async()=>{abort.abort();};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,abort.signal)).rejects.toThrow();
 expect(f.calls.filter(x=>x==='COMMIT')).toHaveLength(1);expect(f.calls).toContain('ROLLBACK');
});
it('destroys the connection if operation lock acquisition has an unknown outcome',async()=>{
 const f=fixture(),query=f.client.query;
 f.client.query=async(sql,params)=>{if(sql.includes('pg_try_advisory_lock'))throw Error('connection interrupted');return query(sql,params);};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('connection interrupted');
 expect(f.calls).not.toContain('claim');expect(f.calls.at(-1)).toBe('destroy');
});

it('withholds success if the owned advisory unlock cannot be confirmed',async()=>{
 const f=fixture(),query=f.client.query;
 f.client.query=async(sql,params)=>{if(sql.includes('pg_advisory_unlock'))return {rows:[{unlocked:false}]};return query(sql,params);};
 await expect(new FileOperationLifecycle(f.pool,1,1000).runOperation(identity(),f.hooks,new AbortController().signal)).rejects.toThrow('FILE_OPERATION_FENCE_RELEASE_UNCERTAIN');
 expect(f.calls.at(-1)).toBe('destroy');
});
