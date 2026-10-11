import {describe,it,expect} from 'vitest';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {inspectPreservationFile,Preservation,type PreservationFile} from './preservation.ts';
import type {Session} from './auth.ts';
const id='10000000-0000-4000-8000-000000000001';
const input:PreservationFile={id,kind:'source',revision:1,mime:'image/png',bytes:3,sha256:sha256(Buffer.from('abc')),state:'unverified'};
const store=(get:BlobStore['get'])=>({get} as BlobStore);
describe('technical preservation inventory',()=>{
 it('compares actual bytes without returning storage keys or artist scores',async()=>{const r=await inspectPreservationFile(store(async()=>Buffer.from('abc')),input,'tenant/private',{bytes:0});expect(r.state).toBe('verified');expect(JSON.stringify(r)).not.toContain('tenant/private');expect(r).not.toHaveProperty('score');});
 it('distinguishes missing master, mismatch, unsupported format and unavailable observation',async()=>{expect((await inspectPreservationFile(store(async()=>{throw Object.assign(Error('private path'),{code:'ENOENT'});}),input,'private',{bytes:0})).state).toBe('missing');expect((await inspectPreservationFile(store(async()=>Buffer.from('abd')),input,'private',{bytes:0})).state).toBe('hash-mismatch');expect((await inspectPreservationFile(store(async()=>{throw Error('must not read');}),{...input,mime:'unknown/legacy'},'private',{bytes:0})).state).toBe('unsupported-format');expect((await inspectPreservationFile(undefined,input,'private',{bytes:0})).state).toBe('unverified');});
 it('projects original missing, mismatch, unknown-version warnings from tenant rows',async()=>{
  const c={query:async(sql:string)=>{
   if(sql.includes('SELECT m.role'))return{rows:[{role:'artist'}]};
   if(sql.includes('owner_user_id'))return{rows:[{owner_user_id:id,revision:1,metadata:{}}]};
   if(sql.includes('FROM artwork_revisions'))return{rows:[{revision:1,snapshot:{},created_at:'2026-01-01T00:00:00Z',approval:{importedArtwork:{schemaVersion:'unknown'}}}]};
   if(sql.includes('FROM assets a LEFT'))return{rows:[{...input,object_key:'missing',deleted_at:'2026-01-01'}, {...input,id:'10000000-0000-4000-8000-000000000002',object_key:'mismatch'}, {...input,id:'10000000-0000-4000-8000-000000000003',object_key:'unsupported',mime:'unknown/legacy'}]};
   return{rows:[]};
  }} as unknown as PoolClient;
  const r=await new Preservation(store(async()=>Buffer.from('abd'))).inventory(c,{tenantId:id,userId:id,role:'artist'} as Session,id);
  expect(r.warnings.map(w=>w.code)).toEqual(expect.arrayContaining(['MISSING_MASTER','HASH_MISMATCH','UNSUPPORTED_FORMAT','UNSUPPORTED_VERSION']));
  expect(r.observationComplete).toBe(false);expect(r.fields.captureDate).toBe('unknown');expect(r.fields.highResolutionMaster).toBe('unknown');expect(r.limits.backupOrIndependentRestoreVerified).toBe(false);expect(JSON.stringify(r)).not.toContain('object_key');expect(r).not.toHaveProperty('score');
 });
 it('uses real tenant access before byte reads and denies a different artwork owner',async()=>{let reads=0;const queries:string[]=[];const c={query:async(sql:string)=>{queries.push(sql);if(sql.includes('SELECT m.role'))return{rows:[{role:'artist'}]};if(sql.includes('owner_user_id'))return{rows:[{owner_user_id:'another-owner'}]};return{rows:[]};}} as unknown as PoolClient;const s={tenantId:id,userId:id,role:'artist'} as Session;await expect(new Preservation(store(async()=>{reads++;return Buffer.from('abc');})).inventory(c,s,id)).rejects.toMatchObject({code:'FORBIDDEN'});expect(reads).toBe(0);expect(queries.every(q=>q.startsWith('SELECT'))).toBe(true);});
});
