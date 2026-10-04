// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {ServiceInventory} from './service-inventory.js';
import {verifySourceInventory} from './service-backup.js';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const inventory:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:'2026-01-01T00:00:00Z',schemaDigest:hash('schema'),migrations:[{name:'001.sql',sha256:hash('migration')}],tables:[{name:'rows',rowCount:1,sha256:hash('row')},{name:'sequence',rowCount:1,sha256:hash('sequence')}],objects:[{key:'synthetic/objects/one',bytes:3,sha256:hash('obj'),referenced:false,bindings:[]}],references:[],issues:[]};
 const manifest={schemaVersion:'1.0.0-draft.1',kind:'service-backup',id:'bcf0ef6a-2758-4b2c-b950-05ae6f6f062b',createdAt:inventory.createdAt,sourceIdentity:{systemIdentifier:'123',databaseOid:'456',database:'synthetic'},inventory,files:[{role:'database',path:'files/00000000.gcm',bytes:1,cipherBytes:37,sha256:hash('dump'),cipherSha256:hash('encrypted')},{role:'object',path:'files/00000001.gcm',key:'synthetic/objects/one',bytes:3,cipherBytes:39,sha256:hash('obj'),cipherSha256:hash('encrypted object')}]};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)),queries:string[]=[];let released: boolean|undefined;
 const client={async query(sql:string):Promise<{rows:Record<string,unknown>[]}>{queries.push(sql);return {rows:sql.includes('pg_try_advisory')?[{locked:true}]:sql.includes('pg_advisory_unlock')?[{unlocked:true}]:sql.includes('pg_control_system')?[{system:'123',oid:'456',database:'synthetic'}]:[]};},release(broken:boolean){released=broken;}};
 const pool={async connect(){return client;}} as unknown as Pool;
 return {inventory,manifestBytes,queries,client,pool,released:()=>released,options:{pool,manifestBytes,expectedManifestSha256:hash(manifestBytes),snapshot:async()=>({...inventory,createdAt:'2026-10-04T00:00:00Z'})}};
}
test('observation fences before two fresh read-only snapshots and never returns private inventory',async()=>{
 const f=fixture(),result=await verifySourceInventory(f.options);
 expect(f.queries[0]).toContain('pg_try_advisory_lock');expect(f.queries.filter(q=>q==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')).toHaveLength(2);expect(f.queries.filter(q=>q==='ROLLBACK')).toHaveLength(2);expect(f.queries.at(-1)).toContain('pg_advisory_unlock');expect(f.released()).toBe(false);
 expect(result.currentInventoryVerified).toBe(true);expect(result.preflightVerified).toBe(false);expect(result.configurationVerified).toBe(false);expect(JSON.stringify(result)).not.toContain('synthetic/objects/one');
});
test.each(['row','sequence','object','migration','schema','reference','issue','second-pass'])('changed %s refuses current source equality',async kind=>{
 const f=fixture();let pass=0;
 const snapshot=async()=>{const v=structuredClone(f.inventory);pass++;if(kind==='second-pass'&&pass===1)return v;
 if(kind==='row'||kind==='second-pass')v.tables[0]!.sha256=hash('changed');
 if(kind==='sequence')v.tables[1]!.sha256=hash('changed');
 if(kind==='object')v.objects[0]!.sha256=hash('changed');
 if(kind==='migration')v.migrations[0]!.sha256=hash('changed');
 if(kind==='schema')v.schemaDigest=hash('changed');
 if(kind==='reference')v.objects[0]!.bindings.push('foreign binding');
 if(kind==='issue')return {...v,issues:[{code:'OBJECT_MISSING'}]};return v;
 };
 await expect(verifySourceInventory({...f.options,snapshot})).rejects.toThrow();expect(f.queries.at(-1)).toContain('pg_advisory_unlock');expect(f.released()).toBe(false);
});
test('hash binding refuses before DB connection; busy and foreign DB identities refuse',async()=>{
 const f=fixture();await expect(verifySourceInventory({...f.options,expectedManifestSha256:hash('foreign')})).rejects.toThrow('SOURCE_MANIFEST_MISMATCH');expect(f.queries).toEqual([]);
 f.client.query=async()=>({rows:[{locked:false}]});await expect(verifySourceInventory(f.options)).rejects.toThrow('SOURCE_INVENTORY_BUSY');
 const g=fixture(),original=g.client.query;g.client.query=async sql=>sql.includes('pg_control_system')?{rows:[{system:'789',oid:'456',database:'synthetic'}]}:original(sql);
 await expect(verifySourceInventory(g.options)).rejects.toThrow('SOURCE_DATABASE_MISMATCH');
});
test('unlock failure destroys the pooled session and refuses even a matched observation',async()=>{
 const f=fixture(),original=f.client.query;f.client.query=async sql=>sql.includes('pg_advisory_unlock')?{rows:[{unlocked:false}]}:original(sql);
 await expect(verifySourceInventory(f.options)).rejects.toThrow('SOURCE_INVENTORY_CLEANUP_FAILED');expect(f.released()).toBe(true);
});

test('unsupported application schema and collector failure unwind the read-only transaction',async()=>{
 const f=fixture(),original=f.client.query;f.client.query=async sql=>sql.includes('SELECT nspname')?{rows:[{nspname:'unbacked'}]}:original(sql);
 await expect(verifySourceInventory(f.options)).rejects.toThrow('BACKUP_UNSUPPORTED_SCHEMA');expect(f.queries.at(-2)).toBe('ROLLBACK');expect(f.queries.at(-1)).toContain('pg_advisory_unlock');
 const g=fixture();await expect(verifySourceInventory({...g.options,snapshot:async()=>{throw Error('synthetic collector failed');}})).rejects.toThrow('synthetic collector failed');expect(g.queries.at(-2)).toBe('ROLLBACK');expect(g.released()).toBe(false);
});
