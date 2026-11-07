// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
const state=vi.hoisted(()=>({client:undefined as unknown as PoolClient,artwork:{revision:1,metadata:{rights:{same:true}}},coarse:undefined as unknown}));
vi.mock('@exhibitos/storage',async original=>({...await original<typeof import('@exhibitos/storage')>(),transaction:async(_pool:unknown,fn:(c:PoolClient)=>unknown)=>await fn(state.client),artworkAccess:async()=>state.artwork}));
vi.mock('./rights.ts',()=>({validRights:()=>true,allowedRights:()=>true}));
vi.mock('./validation-client.ts',()=>({decode:async()=>({})}));
vi.mock('./image-coarse-intent.ts',()=>({storedImageCoarse:()=>state.coarse,imageCoarseIntent:()=>undefined,imageCoarsePolicy:()=>undefined}));
vi.mock('./artwork-coarse-preparation.ts',()=>({prepareIntentImageCoarse:async()=>({bytes:Buffer.from('coarse'),width:512,height:408,profile:'viewer-png-box-512-v1'})}));
import {Imports} from './imports.ts';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('stages job-scoped coarse before atomic asset registration and drains its worker',async()=>{
 const original=Buffer.from([255,216,255,217]),png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(2048,16);png.writeUInt32BE(1630,20);png[24]=8;png[25]=2;
 const intent={version:1,profile:'viewer-png-box-512-v1',approvalId:'policy',artworkRevision:1},coarse={intent,workspaceId:'workspace',principalId:'user',stageKey:'tenant/quarantine/import-job/coarse',sha256:hash(Buffer.from('coarse')),bytes:6};state.coarse=coarse;
 const row={tenant_id:'tenant',id:'job',user_id:'user',artwork_id:'art',mime:'image/jpeg',expected_bytes:original.length,expected_hash:hash(original),object_key:'source',derived_object_key:'prepared',approved_key:'approved',derived:{sha256:hash(png),bytes:png.length,recipe:{}},rights:{same:true},model_derivation:null,png_drain_version:1};
 const events:string[]=[],currentRevision=1;
 const query=vi.fn(async(sql:string)=>{if(sql.includes('FOR UPDATE SKIP LOCKED'))return {rowCount:1,rows:[row]};if(sql.includes("state='processing' AND lease_id"))return {rowCount:1,rows:[row]};if(sql.includes('lease_until>clock_timestamp() AS valid')||sql.includes('AS valid FROM import_jobs'))return {rowCount:1,rows:[{valid:true}]};if(sql.startsWith('INSERT INTO assets'))events.push('asset');if(sql.startsWith('INSERT INTO asset_derivatives'))events.push('derivative');if(sql.includes('array_remove(png_worker_tokens'))events.push('drained');return {rowCount:1,rows:[]};});state.client={query} as unknown as PoolClient;state.artwork={revision:currentRevision,metadata:{rights:{same:true}}};
 const store=new Map<string,Buffer>([['source',original],['prepared',png]]);const blobs={get:async(key:string)=>{const b=store.get(key);if(!b)throw Error('missing');return b;},getBounded:async(key:string,limit:number)=>{const b=store.get(key);if(!b||b.length!==limit)throw Error('missing');return b;},put:async(key:string,value:Uint8Array)=>{events.push(key===coarse.stageKey?'coarse-staged':'other-put');store.set(key,Buffer.from(value));}} as unknown as BlobStore;
 const native={workspaceId:'workspace',tenantId:'tenant',principalId:'user',assertDatabase:async()=>{}} as unknown as NativeOexWorkspaceContext;const imports=new Imports({} as Pool,blobs,native);vi.spyOn(imports,'prepared').mockReturnValue({mime:'image/png',bytes:png.length,sha256:hash(png),recipe:{version:1,role:'baseColor',sampling:'nearest-centre',colourMeaning:'srgb',recipeSha256:'a',settingsSha256:'b',sourcePixelsSha256:'c',outputPixelsSha256:'d',toolVersion:'test'}});
 expect(await imports.work()).toBe(true);expect(events.indexOf('coarse-staged')).toBeGreaterThanOrEqual(0);expect(events.indexOf('coarse-staged')).toBeLessThan(events.indexOf('asset'));expect(events.filter(x=>x==='asset')).toHaveLength(3);expect(events).toContain('derivative');expect(events.at(-1)).toBe('drained');
});
