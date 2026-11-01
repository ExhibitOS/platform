// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {spaceStillFor} from '@exhibitos/spec/space-still';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {Oex,remapOex,type PreparedOexImportAttachment} from './oex.ts';
import {Studio,etag} from './studio.ts';

afterEach(()=>vi.restoreAllMocks());
async function fixture(terminal=true){
 const parsed=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),mapped=remapOex(parsed.exhibition),keys=new Map<string,string>();
 const session:Session={id:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),role:'admin',csrfToken:'',expiresAt:'2099-01-01T00:00:00Z'},job={id:randomUUID(),leaseId:randomUUID(),payloadSha256:'a'.repeat(64)};
 for(const art of mapped.exhibition.artworks)for(const asset of art.assets)keys.set(asset.path,`${session.tenantId}/oex-import/${job.id}/${job.leaseId}/${randomUUID()}`);
 for(const media of mapped.exhibition.mediaAssets)keys.set(media.path,`${session.tenantId}/oex-import/${job.id}/${job.leaseId}/${randomUUID()}`);
 const still=spaceStillFor(mapped.exhibition);if(still)keys.set(still.path,`${session.tenantId}/oex-import/${job.id}/${job.leaseId}/${randomUUID()}`);
 const prepared:PreparedOexImportAttachment={...mapped,keys,mediaDurations:new Map(mapped.exhibition.mediaAssets.map(m=>[m.id,1])),floorResources:[],materialResources:[],footstepResources:[]};
 const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT lease_until')?{rows:[{valid:true}],rowCount:1}:sql.startsWith("UPDATE oex_import_jobs SET state='complete'")?{rows:terminal?[{id:job.id}]:[],rowCount:terminal?1:0}:{rows:[],rowCount:1});
 const client={query} as unknown as PoolClient,pool={connect:vi.fn(()=>{throw Error('no owned transaction');}),query:vi.fn(()=>{throw Error('no pooled query');})} as unknown as Pool;
 const forbidden=vi.fn(async()=>{throw Error('no blob IO during attachment');}),blobs={get:forbidden,put:forbidden,remove:forbidden,list:forbidden} as unknown as BlobStore;
 const create=vi.spyOn(Studio.prototype,'create').mockImplementation(async(_c,_s,{draft})=>({revision:1,etag:etag(1,draft),draft}));
 return {prepared,session,job,query,client,pool,forbidden,create,oex:new Oex(pool,blobs)};
}
it('attaches prequalified metadata in the supplied transaction without any blob IO or source mutation',async()=>{
 const f=await fixture(),before=structuredClone(f.prepared),result=await f.oex.attachPrepared(f.client,f.session,f.job,f.prepared);
 expect(f.forbidden).not.toHaveBeenCalled();expect(f.pool.connect).not.toHaveBeenCalled();expect(f.pool.query).not.toHaveBeenCalled();expect(f.prepared).toEqual(before);
 expect(result.exhibitionId).toBe(before.exhibition.id);expect(result.idMap).toEqual(before.idMap);expect(result.assetAliases).toEqual(before.assetAliases);expect(f.create).toHaveBeenCalledOnce();
 const sql=f.query.mock.calls.map(([text])=>text);expect(sql.some(text=>/^(BEGIN|COMMIT|ROLLBACK)/.test(text))).toBe(false);
 for(const table of ['artists','artist_revisions','artworks','artwork_revisions','rights','assets','artwork_approvals','audit_events'])expect(sql.some(text=>text.startsWith('INSERT INTO '+table+'('))).toBe(true);
 expect(sql.find(text=>text.startsWith("UPDATE oex_import_jobs SET state='complete'"))).toContain('payload_sha256=$5 AND user_id=$6 RETURNING id');
});
it('rejects a terminal lease/source mismatch instead of reporting a completed import',async()=>{
 const f=await fixture(false);await expect(f.oex.attachPrepared(f.client,f.session,f.job,f.prepared)).rejects.toMatchObject({code:'LEASE_EXPIRED'});
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO audit_events'))).toBe(false);expect(f.forbidden).not.toHaveBeenCalled();
});
it('checks the exact same-transaction terminal result without treating it as commit or drain proof',async()=>{
 const f=await fixture(),result=await f.oex.attachPrepared(f.client,f.session,f.job,f.prepared),row={state:'complete',user_id:f.session.userId,payload_sha256:f.job.payloadSha256,lease_id:null,lease_until:null,result};
 const query=vi.fn(async()=>({rows:[row]})),client={query} as unknown as PoolClient;
 await f.oex.checkAttached(client,f.session,f.job,result);
 row.result={...result,exhibitionId:randomUUID()};await expect(f.oex.checkAttached(client,f.session,f.job,result)).rejects.toMatchObject({code:'OEX_ATTACHMENT_CHANGED'});expect(f.forbidden).not.toHaveBeenCalled();
});
