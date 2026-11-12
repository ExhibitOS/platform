// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {CURRENT_IMAGE_THUMBNAIL_PROFILE} from './current-image-thumbnail.ts';
import {imagePreparationLineage} from './image-preparation-lineage.ts';
import {canonicalImageHash} from './product-image-intent.ts';
import {FRESH_IMAGE_RECIPE_SHA256,PRODUCT_IMAGE_PROFILE,PRODUCT_IMAGE_RECIPE,PRODUCT_IMAGE_RECIPE_SHA256} from './product-image-preparation.ts';

function fixture(){
 const artworkId=randomUUID(),tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),assetId=randomUUID(),jobId=randomUUID(),originalId=randomUUID();
 const rights={holder:'Synthetic owner',creditLine:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:false,export:true,commercial:false}},sourceHash='a'.repeat(64),fullHash='b'.repeat(64);
 const original={assetId:originalId,sha256:sourceHash,bytes:100,mime:'image/jpeg' as const},full={assetId,sha256:fullHash,bytes:1000,width:600,height:600,mime:'image/png' as const};
 // Synthetic receipt-shape proof only; not an encoder/pixel correspondence claim.
 const producer={version:1,recipeSHA256:PRODUCT_IMAGE_RECIPE_SHA256,decoder:PRODUCT_IMAGE_RECIPE.decoder,source:{sha256:sourceHash,bytes:100,width:600,height:600,mime:'image/jpeg',iccSHA256:null},full:{sha256:fullHash,bytes:1000,width:600,height:600}};
 const body={version:1,jobId,artworkId,artworkRevision:1,workspaceId,principalId:userId,rightsSHA256:canonicalImageHash(rights),original,full,producer};
 const result={...body,sha256:canonicalImageHash(body)},prefix=`${tenantId}/quarantine/import-${jobId}`;
 const row={id:jobId,tenant_id:tenantId,user_id:userId,artwork_id:artworkId,mime:'image/jpeg',rights,state:'approved',asset_id:assetId,original_asset_id:originalId,expected_hash:sourceHash,expected_bytes:100,object_key:`${prefix}/${sourceHash}`,derived_object_key:`${prefix}/product-full`,approved_key:`${tenantId}/approved/${fullHash}`,png_drain_version:1,png_worker_tokens:[] as string[],lease_id:null as string|null,derived:{kind:'product-image-pair',request:{version:1,profile:PRODUCT_IMAGE_PROFILE,artworkRevision:1},workspaceId,principalId:userId,result}};
 const art={revision:2,approved_revision:2,approved_asset_id:assetId,metadata:{rights}},graph={id:artworkId,revision:2,primaryAssetId:assetId,artworkType:'image',rights,assets:[{id:assetId,sha256:fullHash,bytes:1000,mime:'image/png'}]};
 const selection={rows:[] as {binding_id:string;version:number}[],rowCount:0},ids=[{id:jobId}];
 const query=vi.fn(async(sql:string,_args?:unknown[])=>{if(!_args?.length)throw Error('missing query parameters');if(sql.includes('FROM artwork_thumbnail_selections'))return selection;if(sql.startsWith('SELECT id FROM import_jobs'))return {rows:ids,rowCount:ids.length};throw Error('unexpected query');});
 const cms={ownArtwork:vi.fn(async()=>art),studioArtwork:vi.fn(async()=>({artwork:graph}))} as unknown as Parameters<typeof imagePreparationLineage>[4];
 const imports={coarseOwner:vi.fn(async()=>({workspaceId})),access:vi.fn(async()=>row)} as unknown as Parameters<typeof imagePreparationLineage>[5];
 const session={tenantId,userId,role:'admin'} as Session,input={expectedRevision:2,approvedAssetId:assetId};
 const read=()=>imagePreparationLineage({query} as unknown as PoolClient,session,artworkId,input,cms,imports);
 return {row,result,art,graph,selection,ids,query,cms,imports,session,input,artworkId,workspaceId,read};
}
it('discovers only current-owner current-Full jobs and reuses actual receipt validation for a reviewable repair',async()=>{
 const f=fixture(),r=await f.read();expect(r.scope).toBe('current-owner-current-approved-full');expect(r.items).toHaveLength(1);
 expect(r.items[0]).toMatchObject({jobId:f.row.id,kind:'product-image-pair',workerDrained:true,disposition:'reviewable-repair',repair:{kind:'product-image-thumbnail-repair-v1',artworkId:f.artworkId,artworkRevision:2,importJobId:f.row.id}});
 const [sql,args]=f.query.mock.calls.find(([sql])=>sql.startsWith('SELECT id FROM import_jobs'))!;
 expect(sql).toContain('tenant_id=$1 AND user_id=$2 AND artwork_id=$3 AND asset_id=$4');expect(sql).toContain('LIMIT 21');
 expect(args).toEqual([f.session.tenantId,f.session.userId,f.artworkId,f.input.approvedAssetId,f.workspaceId,null]);expect(f.query.mock.calls.some(([sql])=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
});
it('rejects stale revision or another Full ID even with matching bytes, before discovery',async()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.input.expectedRevision=1;},(f:ReturnType<typeof fixture>)=>{f.input.approvedAssetId=randomUUID();}]){
  const f=fixture();change(f);await expect(f.read()).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(f.query).not.toHaveBeenCalled();
 }
});
it('does not return foreign tenant, principal, artwork, Full or workspace job records',async()=>{
 for(const key of ['tenant_id','user_id','artwork_id','asset_id'] as const){const f=fixture();f.row[key]=randomUUID();await expect(f.read()).rejects.toMatchObject({code:'IMAGE_PREPARATION_CONTEXT_CHANGED'});}
 const f=fixture();f.row.derived.workspaceId=randomUUID();f.result.workspaceId=f.row.derived.workspaceId;
 await expect(f.read()).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('does not turn malformed or changed receipt identity into repair eligibility',async()=>{
 const f=fixture();f.result.sha256='f'.repeat(64);await expect(f.read()).rejects.toMatchObject({code:'IMAGE_PREPARATION_RECEIPT_INVALID'});
 const g=fixture();g.graph.assets[0]!.sha256='c'.repeat(64);await expect(g.read()).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
});
it('keeps legacy/client-declared jobs, undrained jobs and existing selection out of repair candidates',async()=>{
 const legacy=fixture();Object.assign(legacy.row,{derived:{mime:'image/png',bytes:1000,sha256:legacy.graph.assets[0]!.sha256,recipe:{colourConversion:{algorithm:'historical'}}}});
 const old=await legacy.read();expect(old.items[0]).toMatchObject({kind:'client-declared-image',disposition:'unsupported-repair-kind',repair:null});expect(old.items[0]).not.toHaveProperty('serverReceipt');
 const busy=fixture();busy.row.png_worker_tokens.push(randomUUID());expect((await busy.read()).items[0]).toMatchObject({disposition:'not-ready',repair:null});
 const selected=fixture();selected.selection.rows.push({binding_id:randomUUID(),version:1});selected.selection.rowCount=1;expect((await selected.read()).items[0]).toMatchObject({disposition:'thumbnail-already-selected',repair:null});
});
it('bounds pages to twenty authorized jobs and makes an empty result only a scoped observation',async()=>{
 const f=fixture();Object.assign(f.row,{derived:null});f.ids.splice(0,1,...Array.from({length:21},()=>({id:randomUUID()})).sort((a,b)=>a.id.localeCompare(b.id)));
 vi.mocked(f.imports.access).mockImplementation(async(_c,_s,id)=>({...f.row,id}));
 const result=await f.read();expect(result.items).toHaveLength(20);expect(result.nextCursor).toBe(f.ids[19]!.id);
 const empty=fixture();empty.ids.length=0;expect(await empty.read()).toMatchObject({scope:'current-owner-current-approved-full',items:[],nextCursor:null});expect(empty.imports.access).not.toHaveBeenCalled();
});
it('fails closed on revoked rights and a changed current primary before returning the page',async()=>{
 const f=fixture();f.art.metadata.rights.permissions.display=false;await expect(f.read()).rejects.toMatchObject({code:'RIGHTS_DENIED'});expect(f.query).not.toHaveBeenCalled();
 const g=fixture();vi.mocked(g.cms.ownArtwork).mockResolvedValueOnce(g.art).mockResolvedValueOnce({...g.art,approved_asset_id:randomUUID()});await expect(g.read()).rejects.toMatchObject({code:'REVISION_CONFLICT'});
});

it('offers a generated current-Full thumbnail for separate selection without inventing a replacement repair',async()=>{
 const f=fixture(),requestId=randomUUID(),source={assetId:f.input.approvedAssetId,sha256:f.graph.assets[0]!.sha256,bytes:f.graph.assets[0]!.bytes,mime:'image/png' as const};
 const request={requestId,expectedRevision:2},producer={...f.result.producer,recipeSHA256:FRESH_IMAGE_RECIPE_SHA256,source:{...f.result.producer.source,sha256:source.sha256,bytes:source.bytes,mime:'image/png' as const}};
 const body={version:1,profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,jobId:f.row.id,artworkId:f.artworkId,artworkRevision:2,workspaceId:f.workspaceId,principalId:f.session.userId,rightsSHA256:canonicalImageHash(f.row.rights),source,thumbnail:{assetId:randomUUID(),sha256:'d'.repeat(64),bytes:500,mime:'image/png',width:256,height:256},producer};
 const receipt={...body,sha256:canonicalImageHash(body)},key=`${f.session.tenantId}/approved/${source.sha256}`;
 Object.assign(f.row,{mime:'image/png',original_asset_id:null,expected_hash:source.sha256,expected_bytes:source.bytes,object_key:key,approved_key:key,derived_object_key:`${f.session.tenantId}/quarantine/import-${f.row.id}/image-thumbnail.png`,idempotency_key:`image-thumbnail:${requestId}`,request_hash:canonicalImageHash({profile:CURRENT_IMAGE_THUMBNAIL_PROFILE,artworkId:f.artworkId,...request,source,rights:f.row.rights,workspaceId:f.workspaceId,principalId:f.session.userId}),derived:{kind:'current-approved-image-thumbnail',request,workspaceId:f.workspaceId,principalId:f.session.userId,source,result:receipt}});
 const result=await f.read();expect(result.items[0]).toMatchObject({kind:'current-approved-image-thumbnail',disposition:'reviewable-thumbnail-selection',repair:null,thumbnailPreparation:{status:'ready',workerDrained:true,selectionCandidate:{sourceAssetId:source.assetId,thumbnailAssetId:receipt.thumbnail.assetId}}});
 f.selection.rowCount=1;expect((await f.read()).items[0]).toMatchObject({disposition:'thumbnail-already-selected',repair:null});
});
