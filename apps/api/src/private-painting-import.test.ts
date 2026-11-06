// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
const state=vi.hoisted(()=>({client:undefined as unknown as PoolClient,approval:[] as unknown[],artwork:{revision:1,metadata:{rights:{}}},accessAllowed:true}));
vi.mock('@exhibitos/storage',async original=>({...await original<typeof import('@exhibitos/storage')>(),transaction:async(_pool:unknown,fn:(c:PoolClient)=>unknown)=>fn(state.client),artworkAccess:async()=>{if(!state.accessAllowed)throw Error('access revoked');return state.artwork;}}));
vi.mock('./approved-private-painting-imports.ts',()=>({APPROVED_PRIVATE_PAINTING_IMPORTS:state.approval}));
vi.mock('./private-painting-validation.ts',()=>({decodePrivatePaintingPng:vi.fn(async()=>{})}));
import {Imports} from './imports.ts';
import {decodePrivatePaintingPng} from './private-painting-validation.ts';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:false},creditLine:'synthetic'};
function fixture(){
 const original=Buffer.from([255,216,1,2]),png=Buffer.from('synthetic prepared png'),meaning='srgb-assumed';
 const recipeSha256=hash(Buffer.from(JSON.stringify({colourMeaning:meaning,role:'baseColor',sampling:'nearest-centre',version:1})));
 const derived={mime:'image/png',bytes:png.length,sha256:hash(png),recipe:{version:1,role:'baseColor',sampling:'nearest-centre',colourMeaning:meaning,recipeSha256,settingsSha256:'a'.repeat(64),sourcePixelsSha256:'b'.repeat(64),outputPixelsSha256:'c'.repeat(64),toolVersion:'synthetic'}};
 const row:Record<string,unknown>={tenant_id:'tenant',id:'job',user_id:'user',artwork_id:'art',mime:'image/jpeg',expected_bytes:original.length,expected_hash:hash(original),object_key:'tenant/quarantine/job/original',approved_key:'tenant/approved/shared',derived_object_key:'tenant/quarantine/job/prepared',derived,rights,model_derivation:null,state:'processing'};
 const approval={tenantId:'tenant',artworkId:'art',revision:1,rights,originalSha256:hash(original),originalBytes:original.length,prepared:structuredClone(derived),profile:'painting-1925x2634',colour:{kind:'no-profile-srgb-assumed'},receiptSha256:'d'.repeat(64)};
 state.approval.splice(0,state.approval.length,approval);state.accessAllowed=true;state.artwork={revision:1,metadata:{rights}};
 const blobs=new Map([[row.object_key as string,original],[row.derived_object_key as string,png]]);let active=true,failed:unknown;const writes:string[]=[];
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('FOR UPDATE SKIP LOCKED'))return {rowCount:1,rows:[row]};
  if(sql.startsWith('SELECT * FROM import_jobs')&&sql.includes('lease_until>'))return active?{rowCount:1,rows:[row]}:{rowCount:0,rows:[]};
  if(sql.startsWith('SELECT revision,metadata FROM artworks'))return {rowCount:1,rows:[state.artwork]};
  if(sql.startsWith('SELECT lease_until>'))return {rowCount:1,rows:[{valid:true}]};
  if(sql.startsWith('INSERT INTO assets')||sql.startsWith('INSERT INTO rights')||sql.startsWith('INSERT INTO asset_derivatives'))writes.push(sql);
  if(sql.includes("state='failed',error_code=$4"))failed=args[3];
  return {rowCount:1,rows:[]};
 });
 state.client={query} as unknown as PoolClient;
 const put=vi.fn(),remove=vi.fn(),store={get:vi.fn(async(key:string)=>{const b=blobs.get(key);if(!b)throw Error('missing');return b;}),put,remove} as unknown as BlobStore;
 return {row,approval,blobs,writes,put,remove,query,imports:new Imports({} as Pool,store),cancel:()=>{active=false;},failed:()=>failed};
}
it('commits only a server-approved exact input and keeps the owned prepared object',async()=>{
 const f=fixture();await f.imports.work();expect(f.failed()).toBeUndefined();expect(decodePrivatePaintingPng).toHaveBeenCalled();expect(f.writes.some(s=>s.startsWith('INSERT INTO assets'))).toBe(true);expect(f.put).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE import_jobs SET approved_key='))).toBe(true);
});
it.each(['tenant','revision','rights','bytes','cancel','membership','recipe'] as const)('does not commit a private asset on %s change',async kind=>{
 const f=fixture();await f.imports.work({beforeCommit:()=>{if(kind==='tenant')f.row.tenant_id='other';if(kind==='revision')state.artwork={...state.artwork,revision:2};if(kind==='rights')state.artwork={...state.artwork,metadata:{rights:{}}};if(kind==='bytes')f.blobs.set(f.row.derived_object_key as string,Buffer.from('changed'));if(kind==='cancel')f.cancel();if(kind==='membership')state.accessAllowed=false;if(kind==='recipe')(f.row.derived as {recipe:{settingsSha256:string}}).recipe.settingsSha256='e'.repeat(64);}});
 expect(f.writes).toEqual([]);expect(f.put).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
});

it('client input cannot grant authority and the existing oversized path stays bounded',async()=>{
 const f=fixture();vi.mocked(decodePrivatePaintingPng).mockClear();state.approval.splice(0,state.approval.length);await f.imports.work();expect(f.writes).toEqual([]);expect(f.put).not.toHaveBeenCalled();expect(decodePrivatePaintingPng).not.toHaveBeenCalled();
});
