// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterAll,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,stat,rm,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {PublicationAttempts,type PublicationAttempt} from './publication-attempt.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-publication-attempt-')));
afterAll(()=>rm(root,{recursive:true,force:true}));
async function fixture(){
 const dir=await mkdtemp(join(root,'journal-')),store=await mkdtemp(join(root,'store-')),s=await stat(store,{bigint:true}),bytes=Buffer.from('synthetic owned publication');
 const a:PublicationAttempt={version:1,attemptId:randomUUID(),generation:randomUUID(),owner:{databaseSystemId:'123',databaseOid:'456',storeRoot:store,storeDevice:String(s.dev),storeInode:String(s.ino)},tenantId:randomUUID(),userId:randomUUID(),requestId:randomUUID(),exhibitionId:randomUUID(),etag:'"studio-r2-'+ 'c'.repeat(64)+'"',payloadHash:'a'.repeat(64),publicationId:randomUUID(),snapshotHash:'b'.repeat(64),objects:[]};
 a.objects.push({key:`${a.tenantId}/publications/${a.publicationId}/${randomUUID()}/${sha256(bytes)}`,sha256:sha256(bytes),bytes:bytes.length});
 const journal=new PublicationAttempts(dir),blobs=new FileBlobStore(store);return {dir,store,a,journal,blobs,bytes};
}
function database(a:PublicationAttempt,mode:'absent'|'committed'|'conflict'|'query-failure'='absent'){
 const query=vi.fn(async(sql:string,_values?:unknown[])=>{
  void _values;
  if(sql.includes('pg_control_system'))return {rows:[{system_id:a.owner.databaseSystemId,database_oid:a.owner.databaseOid}]};
  if(sql.includes('FROM studio_publications')){if(mode==='query-failure')throw Error('database unavailable');return {rows:mode==='committed'||mode==='conflict'?[{tenant_id:a.tenantId,exhibition_id:a.exhibitionId,created_by:a.userId,revision_sha256:mode==='conflict'?'f'.repeat(64):a.snapshotHash}]:[]};}
  if(sql.includes('FROM publication_requests'))return {rows:mode==='committed'||mode==='conflict'?[{payload_sha256:a.payloadHash,publication_id:a.publicationId}]:[]};
  if(sql.includes('FROM publication_assets'))return {rows:mode==='committed'||mode==='conflict'?a.objects.map(o=>({object_key:o.key,sha256:o.sha256,bytes:o.bytes})):[]};
  return {rows:[]};
 });
 const release=vi.fn(),pool={connect:async()=>({query,release})} as unknown as Pool;return {pool,query,release};
}
it('persists immutable exact bindings across instances and rejects replacement',async()=>{
 const {dir,a,journal}=await fixture();await journal.create(a);expect(await new PublicationAttempts(dir).read(a.attemptId)).toEqual(a);
 await expect(journal.create({...a,snapshotHash:'d'.repeat(64)})).rejects.toMatchObject({code:'EEXIST'});
 expect((await journal.read(a.attemptId)).snapshotHash).toBe(a.snapshotHash);
});
it('rejects foreign prefixes, duplicate objects and oversized or symlink records',async()=>{
 const {dir,a,journal}=await fixture();
 await expect(journal.create({...a,objects:[{...a.objects[0]!,key:'foreign/publications/key'}]})).rejects.toThrow('PUBLICATION_ATTEMPT_INVALID');
 await expect(journal.create({...a,objects:[a.objects[0]!,a.objects[0]!]})).rejects.toThrow('PUBLICATION_ATTEMPT_INVALID');
 await writeFile(join(dir,a.attemptId+'.json'),Buffer.alloc(262145),{mode:0o600});await expect(journal.read(a.attemptId)).rejects.toThrow('PUBLICATION_ATTEMPT_INVALID');
 const alias=randomUUID();await symlink(join(dir,a.attemptId+'.json'),join(dir,alias+'.json'));await expect(journal.read(alias)).rejects.toMatchObject({code:'ELOOP'});
});
it('requires exact generation and positive drain proof before touching the database',async()=>{
 const {a,journal,blobs}=await fixture();await journal.create(a);const {pool,query}=database(a);
 await expect(journal.recover(pool,blobs,a.attemptId,randomUUID(),async()=>true)).rejects.toThrow('PUBLICATION_ATTEMPT_DRAIN_UNCONFIRMED');
 await expect(journal.recover(pool,blobs,a.attemptId,a.generation,async()=>false)).rejects.toThrow('PUBLICATION_ATTEMPT_DRAIN_UNCONFIRMED');expect(query).not.toHaveBeenCalled();
});
it('preserves confirmed commits and refuses conflicting or unavailable DB evidence',async()=>{
 const {a,journal,blobs,bytes}=await fixture();await journal.create(a);await blobs.put(a.objects[0]!.key,bytes);
 for(const mode of ['committed','conflict','query-failure'] as const){const {pool,query,release}=database(a,mode),run=journal.recover(pool,blobs,a.attemptId,a.generation,async()=>true);
  if(mode==='committed')expect(await run).toEqual({outcome:'committed',removed:0});else await expect(run).rejects.toThrow(mode==='conflict'?'PUBLICATION_ATTEMPT_UNCERTAIN':'database unavailable');
  expect(query.mock.calls.slice(0,3).map(([sql])=>sql)).toEqual(['BEGIN','SELECT pg_advisory_xact_lock(82003)','SELECT pg_advisory_xact_lock_shared(82002)']);expect(release).toHaveBeenCalledOnce();expect(Buffer.from(await blobs.get(a.objects[0]!.key))).toEqual(bytes);
 }
});
it('removes only hash-matching owned keys after confirmed absence, retaining the journal and unrelated bytes',async()=>{
 const {a,journal,blobs,bytes}=await fixture();await journal.create(a);await blobs.put(a.objects[0]!.key,bytes);await blobs.put('originals/preserved',bytes);
 expect(await journal.recover(database(a).pool,blobs,a.attemptId,a.generation,async()=>true)).toEqual({outcome:'rolled-back',removed:1});
 await expect(blobs.get(a.objects[0]!.key)).rejects.toMatchObject({code:'ENOENT'});expect(Buffer.from(await blobs.get('originals/preserved'))).toEqual(bytes);expect(await journal.read(a.attemptId)).toEqual(a);
 expect(await journal.recover(database(a).pool,blobs,a.attemptId,a.generation,async()=>true)).toEqual({outcome:'rolled-back',removed:0});
});
it('preserves every key if any owned hash mismatches or the actual store differs',async()=>{
 const {a,journal,blobs,bytes}=await fixture();await journal.create(a);await blobs.put(a.objects[0]!.key,Buffer.from('wrong content'));
 await expect(journal.recover(database(a).pool,blobs,a.attemptId,a.generation,async()=>true)).rejects.toThrow('PUBLICATION_ATTEMPT_UNCERTAIN');expect(Buffer.from(await blobs.get(a.objects[0]!.key))).toEqual(Buffer.from('wrong content'));
 const other=new FileBlobStore(await mkdtemp(join(root,'other-')));await other.put(a.objects[0]!.key,bytes);
 await expect(journal.recover(database(a).pool,other,a.attemptId,a.generation,async()=>true)).rejects.toThrow('PUBLICATION_ATTEMPT_OWNER');expect(Buffer.from(await other.get(a.objects[0]!.key))).toEqual(bytes);
 const cloned={...a,owner:{...a.owner,databaseSystemId:'999'}},db=database(cloned);
 await expect(journal.recover(db.pool,blobs,a.attemptId,a.generation,async()=>true)).rejects.toThrow('PUBLICATION_ATTEMPT_OWNER');
});
it('isolates asynchronous verifier mutations from the validated deletion snapshot',async()=>{
 const {a,journal,blobs,bytes}=await fixture();await journal.create(a);await blobs.put(a.objects[0]!.key,bytes);await blobs.put('originals/foreign',bytes);
 const {pool,query}=database(a);
 const result=await journal.recover(pool,blobs,a.attemptId,a.generation,async copy=>{
  await Promise.resolve();copy.publicationId=randomUUID();copy.owner.storeRoot='/foreign';copy.objects[0]!.key='originals/foreign';return true;
 });
 expect(result).toEqual({outcome:'rolled-back',removed:1});expect(Buffer.from(await blobs.get('originals/foreign'))).toEqual(bytes);
 expect(query.mock.calls.find(([sql])=>sql.includes('FROM studio_publications'))?.[1]).toEqual([a.publicationId]);
});
it('rejects root accessors without evaluating them and pins a data root for the entire recovery',async()=>{
 const {a,journal,blobs,bytes}=await fixture();await journal.create(a);await blobs.put(a.objects[0]!.key,bytes);
 const other=new FileBlobStore(await mkdtemp(join(root,'foreign-')));await other.put(a.objects[0]!.key,bytes);
 let reads=0;Object.defineProperty(blobs,'root',{configurable:true,get:()=>++reads===1?a.owner.storeRoot:other.root});
 await expect(journal.recover(database(a).pool,blobs,a.attemptId,a.generation,async()=>true)).rejects.toThrow('PUBLICATION_ATTEMPT_OWNER');expect(reads).toBe(0);expect(Buffer.from(await other.get(a.objects[0]!.key))).toEqual(bytes);
 const actual=new FileBlobStore(a.owner.storeRoot),db=database(a),original=db.query.getMockImplementation()!;
 db.query.mockImplementation(async(sql,values)=>{if(sql.includes('FROM studio_publications'))expect(Reflect.set(actual,'root',other.root)).toBe(false);return original(sql,values);});
 expect(await journal.recover(db.pool,actual,a.attemptId,a.generation,async()=>true)).toEqual({outcome:'rolled-back',removed:1});expect(Object.isFrozen(actual)).toBe(true);expect(Buffer.from(await other.get(a.objects[0]!.key))).toEqual(bytes);
});
