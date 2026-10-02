// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {FileBlobStore} from './blobs.js';
import {createServiceBackup,verifyServiceBackup} from './service-backup.js';
import type {ServiceInventory} from './service-inventory.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
// DB adapter is isolated here; this test exercises actual archive encryption,
// completion publication and the reader's bounded manifest, not SQL recovery.
test('oversized inventory cannot publish a complete archive that the bounded reader cannot restore',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-backup-limit-'));await mkdir(join(root,'objects'),{mode:0o700});const store=new FileBlobStore(join(root,'objects'));
 const data=Buffer.from('synthetic protected object');await store.put('synthetic/objects/preserved',data);
 const inventory:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),schemaDigest:hash('schema'),migrations:[{name:'001.sql',sha256:hash('migration')}],tables:[],objects:[{key:'synthetic/objects/preserved',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),referenced:false,bindings:['x'.repeat(16*1024*1024)]}],references:[],issues:[]};
 const client={async query(sql:string){return {rows:sql.includes('pg_control_system')?[{system:'123',oid:'456',database:'synthetic'}]:sql.includes('pg_export_snapshot')?[{id:'00000001-00000002-1'}]:[]};},release(){}};
 const pool={async connect(){return client;}} as unknown as Pool;
 const archive=join(root,'archive'),key=randomBytes(32);
 await expect(createServiceBackup({pool,store,destination:archive,encryptionKey:key,snapshot:async()=>inventory,dump:async path=>{await writeFile(path,'synthetic dump',{mode:0o600,flag:'wx'});}})).rejects.toThrow('BACKUP_FAILED');
 await expect(access(join(archive,'complete.json'))).rejects.toThrow();
 expect(JSON.parse(await readFile(join(archive,'failed.json'),'utf8')).status).toBe('failed');expect(await store.get('synthetic/objects/preserved')).toEqual(data);
 await expect(verifyServiceBackup({source:archive,encryptionKey:key,destination:join(root,'refused')})).rejects.toThrow('BACKUP_VERIFY_FAILED');
},10000);
