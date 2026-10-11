// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import type {Pool} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {sha256} from '@exhibitos/storage';
import {Privacy,metricInput,retentionInput,retainedPurpose,privateObjectKey,PRIVACY_METRICS} from './privacy.ts';
const tenant='12345678-1234-4234-8234-123456789012',user='22345678-1234-4234-8234-123456789012',id='32345678-1234-4234-8234-123456789012';
describe('Original privacy lifecycle boundaries',()=>{
 it('covers all original aggregate metrics without accepting private identifiers or movement logs',()=>{
  expect(PRIVACY_METRICS).toHaveLength(6);
  for(const metric of PRIVACY_METRICS){const resource=metric==='room-visit'||metric==='artwork-dwell';expect(metricInput({consent:true,metric,...(resource?{resourceId:id}:{}),...(metric.endsWith('-dwell')?{durationSeconds:12}:{})}).metric).toBe(metric);}
  for(const field of ['ip','sessionId','userId','position','sourceText'])expect(()=>metricInput({consent:true,metric:'visit',[field]:'private'})).toThrow('INVALID_INPUT');
  expect(metricInput({consent:false,metric:'visit'}).consent).toBe(false);
 });
 it('requires explicit bounded duration and genuine resource identifiers',()=>{
  for(const durationSeconds of [0,-1,3601,NaN,Infinity])expect(()=>metricInput({consent:true,metric:'artwork-dwell',resourceId:id,durationSeconds})).toThrow();
  expect(()=>metricInput({consent:true,metric:'room-visit',resourceId:'private URL'})).toThrow();expect(()=>metricInput({consent:true,metric:'visit',resourceId:id})).toThrow();
 });
 it('keeps raw expiry optional and master/web retention independent from analytics',()=>{
  expect(retentionInput({analyticsEnabled:false,analyticsDays:30,rawDays:null}).rawDays).toBeNull();expect(retainedPurpose('master')).toBe(true);expect(retainedPurpose('web')).toBe(true);expect(retainedPurpose('raw')).toBe(false);
  for(const rawDays of [0,-1,3651,'30'])expect(()=>retentionInput({analyticsEnabled:true,analyticsDays:30,rawDays})).toThrow();
  expect(()=>retentionInput({analyticsEnabled:true,analyticsDays:30,rawDays:7,externalAi:true})).toThrow();
 });
 it('refuses other tenant/traversal object keys',()=>{
  privateObjectKey(tenant,`${tenant}/raw/${user}/frame`);
  for(const key of [`${user}/raw/frame`,`${tenant}/raw/../frame`,`${tenant}/raw//frame`,'/private/token'])expect(()=>privateObjectKey(tenant,key)).toThrow();
 });
 it('does not persist opt-out events or read private publication metadata',async()=>{
  let queried=false;const c={query:async()=>{queried=true;throw Error('unexpected query');}};
  expect(await new Privacy({} as Pool).record(c as never,id,{consent:false,metric:'visit'})).toEqual({recorded:false});expect(queried).toBe(false);
 });
 it('commits removal intent and recovers a crash after actual blob removal without repeating erase',async()=>{
  const data=Buffer.from('synthetic raw');let present=true,removeCalls=0,committed='pending',state=committed;
  const job={tenant_id:tenant,id,user_id:user,object_id:id,kind:'object',state};
  const object={tenant_id:tenant,id,owner_user_id:user,object_key:`${tenant}/raw/${user}/frame`,bytes:data.length,sha256:sha256(data)};
  const c={release(){},async query(sql:string){
   if(sql==='BEGIN')state=committed;if(sql==='COMMIT')committed=state;if(sql==='ROLLBACK')state=committed;
   if(sql.startsWith('SELECT * FROM privacy_deletions'))return {rows:[{...job,state}],rowCount:1};
   if(sql.startsWith('SELECT * FROM privacy_objects'))return {rows:[object],rowCount:1};
   if(sql.includes("SET state='removing'"))state='removing';if(sql.includes("SET state='erased'"))state='erased';return {rows:[],rowCount:0};
  }};
  const pool={connect:async()=>c} as unknown as Pool;
  const store={async get(){if(!present)throw Object.assign(Error('missing'),{code:'ENOENT'});return data;},async remove(){present=false;removeCalls++;throw Error('simulated lost response after removal');}} as unknown as BlobStore;
  const privacy=new Privacy(pool,store);await expect(privacy.work()).rejects.toThrow('simulated lost response');expect(committed).toBe('removing');expect(present).toBe(false);
  expect(await privacy.work()).toMatchObject({state:'erased',backupErasure:false});expect(committed).toBe('erased');expect(removeCalls).toBe(1);
 });
 it('erases real login identity while retaining immutable content and registered raw lifetimes',async()=>{
  const changes:{sql:string;args?:unknown[]}[]=[];
  const c={async query(sql:string,args?:unknown[]){changes.push({sql,args});if(sql.startsWith('SELECT 1 FROM privacy_objects'))return {rowCount:1,rows:[{}]};if(sql.includes('FROM pg_constraint'))return {rows:[{relation:'artists',column:'user_id'},{relation:'publication_events',column:'actor_user_id'}]};if(sql.startsWith('SELECT 1 FROM "'))return {rowCount:1,rows:[{}]};return {rowCount:0,rows:[]};}};
  const result=await new Privacy({} as Pool).eraseAccount(c as never,{tenant_id:tenant,id,user_id:user,object_id:null,kind:'account',state:'pending'});
  expect(result).toMatchObject({state:'erased',code:'ACCOUNT_IDENTITY_ERASED_DATA_RETAINED',identityErased:true,retainedData:true,backupErasure:false});
  for(const table of ['auth_credentials','auth_sessions','memberships','institution_tokens','privacy_consents'])expect(changes.some(x=>x.sql.startsWith(`DELETE FROM ${table} `))).toBe(true);
  const identity=changes.find(x=>x.sql.startsWith('UPDATE users SET subject='));expect(identity?.args?.[0]).toBe(user);expect(identity?.args?.[1]).toMatch(/^erased-[0-9a-f-]{36}$/);expect(identity?.sql).toContain('disabled=true');
  expect(changes.some(x=>/^DELETE FROM (users|artists|publication_events|privacy_objects) /.test(x.sql))).toBe(false);
  expect(changes.find(x=>x.sql.includes("SET state='erased'"))?.args?.[2]).toBe('ACCOUNT_IDENTITY_ERASED_DATA_RETAINED');
 });
 it('keeps last-admin protection and still physically removes unreferenced account rows',async()=>{
  let last=true;const mutations:string[]=[];
  const c={async query(sql:string){if(sql.startsWith('SELECT 1 FROM memberships'))return {rowCount:last?1:0,rows:[]};if(sql.includes('FROM pg_constraint'))return {rows:[]};if(sql.startsWith('SELECT'))return {rowCount:0,rows:[]};mutations.push(sql);return {rowCount:1,rows:[]};}};
  const privacy=new Privacy({} as Pool),job={tenant_id:tenant,id,user_id:user,object_id:null,kind:'account',state:'pending'};
  expect(await privacy.eraseAccount(c as never,job)).toMatchObject({state:'blocked',code:'LAST_ADMIN'});expect(mutations.some(x=>x.startsWith('DELETE'))).toBe(false);
  last=false;expect(await privacy.eraseAccount(c as never,job)).toMatchObject({state:'erased',retainedData:false,identityErased:true});expect(mutations).toContain('DELETE FROM users WHERE id=$1');
 });

});
