// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import type {PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
import {collectServiceInventory,inventoryCanonical,rowObjectReferences} from './service-inventory.js';
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const digest=(value:unknown)=>createHash('sha256').update(inventoryCanonical(value)).digest('hex');
const png=Buffer.from('synthetic PNG custody bytes'),pngSha=createHash('sha256').update(png).digest('hex');
function fixture(n=4){
 const workspace=uuid(1),tenant=uuid(2),user=uuid(3),id=uuid(n),request=uuid(n+100),furnishing=uuid(9);
 const rights={holder:'Synthetic',ownership:'owner',permissions:{display:true}},descriptor={id:furnishing,version:1,model:{mime:'model/gltf-binary',sha256:'a'.repeat(64),bytes:123},rights};
 const source={furnishingId:furnishing,furnishingVersion:1,modelSha256:descriptor.model.sha256,modelBytes:123,descriptorSha256:digest(descriptor),rightsSha256:digest(rights)};
 const render={version:1,epoch:uuid(10),sequence:1,tenantId:tenant,principalId:user,requestId:request,furnishingId:furnishing,furnishingVersion:1,modelBytes:123,modelSha256:source.modelSha256,recipeId:'furnishing-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1'};
 const receipt={version:1,purpose:'registered-furnishing-thumbnail',profile:'workspace-furnishing-thumbnail-v1',workspaceId:workspace,candidateId:id,requestId:request,source,renderRequest:render,png:{mime:'image/png',width:256,height:256,sha256:pngSha,bytes:png.length}};
 const requestWire={kind:'workspace-furnishing-thumbnail-v1',requestId:request,renderRequest:render,pngSha256:pngSha,pngBytes:png.length};
 const row={workspace_id:workspace,tenant_id:tenant,user_id:user,id,request_id:request,request_sha256:digest(requestWire),furnishing_id:furnishing,furnishing_version:1,source,render_request:render,png_sha256:pngSha,png_bytes:png.length,object_key:`${tenant}/workspace-furnishing-thumbnail/${workspace}/${id}/${pngSha}`,receipt,receipt_sha256:digest(receipt),created_at:'2026-11-11T18:00:00+00:00'};
 return {row,descriptor,selection:{workspace_id:workspace,tenant_id:tenant,user_id:user,furnishing_id:furnishing,furnishing_version:1,version:1,request_id:uuid(20),request_sha256:digest({furnishingId:furnishing,furnishingVersion:1,requestId:uuid(20),candidateId:id,receiptSha256:row.receipt_sha256,expectedSelectionVersion:0}),candidate_id:id,receipt_sha256:row.receipt_sha256,created_at:row.created_at}};
}
it('retains every ready candidate PNG by exact typed key/hash/bytes, independent from selection history',()=>{
 for(const n of[4,5]){const {row}=fixture(n),result=rowObjectReferences('workspace_furnishing_thumbnail_candidates',row);expect(result.issues).toEqual([]);expect(result.references).toEqual([{key:row.object_key,binding:`workspace_furnishing_thumbnail_candidates:${row.tenant_id}:${row.id}:png`,required:true,expectedBytes:png.length,expectedSha256:pngSha}]);}
 const {selection}=fixture();expect(rowObjectReferences('workspace_furnishing_thumbnail_selections',{...selection,metadata:{object_key:'ignored/arbitrary'}})).toEqual({references:[],issues:[]});
});
it.each(['foreign-key','wrong-owner','wrong-workspace','wrong-model','wrong-descriptor-digest','bad-receipt-hash','bad-request-hash','extra-source','extra-render','extra-receipt','too-big','string-bytes','bad-version','bad-epoch','fraction-sequence','unsafe-sequence','wrong-dimensions','bad-created'])('fails closed on candidate %s before collecting a misleading object reference',kind=>{
 const {row}=fixture();const value:Record<string,unknown>=structuredClone(row);
 switch(kind){
 case 'foreign-key':value.object_key='foreign/objects/a';break;
 case 'wrong-owner':(value.render_request as typeof row.render_request).principalId=uuid(30);break;
 case 'wrong-workspace':value.workspace_id=uuid(30);break;
 case 'wrong-model':(value.source as typeof row.source).modelSha256='c'.repeat(64);break;
 case 'wrong-descriptor-digest':(value.source as typeof row.source).descriptorSha256='invalid';break;
 case 'bad-receipt-hash':value.receipt_sha256='d'.repeat(64);break;
 case 'bad-request-hash':value.request_sha256='e'.repeat(64);break;
 case 'extra-source':value.source={...row.source,object_key:'ignored/never-scanned'};break;
 case 'extra-render':value.render_request={...row.render_request,url:'https://invalid.test'};break;
 case 'extra-receipt':value.receipt={...row.receipt,sha256:row.receipt_sha256};break;
 case 'too-big':value.png_bytes=524289;break;
 case 'string-bytes':value.png_bytes=String(png.length);break;
 case 'bad-version':value.furnishing_version=2;break;
 case 'bad-epoch':(value.render_request as typeof row.render_request).epoch='not-a-uuid';break;
 case 'fraction-sequence':(value.render_request as typeof row.render_request).sequence=1.5;break;
 case 'unsafe-sequence':(value.render_request as typeof row.render_request).sequence=Number.MAX_SAFE_INTEGER+1;break;
 case 'wrong-dimensions':(value.receipt as typeof row.receipt).png.width=512;break;
 case 'bad-created':value.created_at='invalid';break;
 }
 expect(rowObjectReferences('workspace_furnishing_thumbnail_candidates',value)).toEqual({references:[],issues:[expect.objectContaining({code:'INVALID_FURNISHING_THUMBNAIL_CANDIDATE'})]});
});
it('candidate receipt/request canonical hashes ignore object insertion order but never infer keys from unrelated JSON',()=>{
 const {row}=fixture(),receipt=Object.fromEntries(Object.entries(row.receipt).reverse());expect(rowObjectReferences('workspace_furnishing_thumbnail_candidates',{...row,receipt}).issues).toEqual([]);
 expect(rowObjectReferences('unrelated_table',{...row,object_key:'foreign/objects/one'})).toEqual({references:[],issues:[]});
});
it.each([{version:0},{version:1.5},{candidate_id:'bad'},{user_id:'bad'},{receipt_sha256:'bad'},{furnishing_version:2}])('validates selection event identity and immutable binding %j without inventing a blob reference',change=>{
 const {selection}=fixture();expect(rowObjectReferences('workspace_furnishing_thumbnail_selections',{...selection,...change})).toEqual({references:[],issues:[expect.objectContaining({code:'INVALID_FURNISHING_THUMBNAIL_SELECTION'})]});
});
function collector(change?:'descriptor'|'owner'|'missing-object'|'source-model'){
 const first=fixture(4),second=fixture(5),records=[first,second],cursors=new Map<string,{kind:'rows'|'join';table?:string;done:boolean}>(),queries:string[]=[];
 const c={async query(sql:string){queries.push(sql);
  if(sql.includes('SELECT c.relname AS name'))return {rows:['workspace_furnishing_thumbnail_candidates','workspace_furnishing_thumbnail_selections'].map(name=>({name,scoped:true}))};
  if(sql.startsWith('DECLARE')){const name=sql.match(/^DECLARE "([^"]+)"/)![1]!;if(name.startsWith('thumbnail_binding_'))cursors.set(name,{kind:'join',done:false});else cursors.set(name,{kind:'rows',table:sql.includes('public."workspace_furnishing_thumbnail_candidates"')?'candidate':'selection',done:false});return {rows:[]};}
  if(sql.startsWith('FETCH')){const name=sql.match(/FROM "([^"]+)"/)![1]!,cursor=cursors.get(name)!;if(cursor.done)return {rowCount:0,rows:[]};cursor.done=true;
   if(cursor.kind==='rows')return {rowCount:cursor.table==='candidate'?2:1,rows:(cursor.table==='candidate'?records.map(f=>f.row):[first.selection]).map(row=>({raw:JSON.stringify(row)}))};
   const rows=records.map(f=>({...f.row,descriptor:structuredClone(f.descriptor),registered_tenant_id:f.row.tenant_id,registered_user_id:f.row.user_id}));
   if(change==='descriptor')rows[0]!.descriptor.rights.holder='Changed';if(change==='owner')rows[0]!.registered_user_id=uuid(55);if(change==='source-model')rows[0]!.descriptor.model.bytes++;
   return {rowCount:rows.length,rows};
  }
  return {rows:[],rowCount:0};
 }} as unknown as PoolClient;
 const keys=records.map(f=>f.row.object_key),store={async list(){return change==='missing-object'?keys.slice(0,1):keys;},async get(){return png;}} as unknown as BlobStore;
 return {c,store,tenant:first.row.tenant_id,queries,keys};
}
it('tenant snapshot scans both ready historical candidates and append-only events; selection never hides an unselected PNG',async()=>{
 const f=collector(),result=await collectServiceInventory(f.c,f.store,{tenantId:f.tenant,migrationDirectory:'/unused'});expect(result.issues).toEqual([]);expect(result.references.map(r=>r.key).sort()).toEqual([...f.keys].sort());expect(result.references.every(r=>r.required)).toBe(true);expect(f.queries.some(q=>q.includes('thumbnail_binding_'))).toBe(true);
});
it.each(['descriptor','owner','source-model','missing-object'] as const)('current inventory rejects registered-source drift or lost candidate %s',async change=>{
 const f=collector(change),result=await collectServiceInventory(f.c,f.store,{tenantId:f.tenant,migrationDirectory:'/unused'});expect(result.issues).toContainEqual(expect.objectContaining({code:change==='missing-object'?'OBJECT_MISSING':'FURNISHING_THUMBNAIL_SOURCE_BINDING_INVALID'}));
});

it('rejects noncanonical thumbnail receipt values rather than hashing undefined or negative zero',()=>{
 const {row}=fixture();for(const bad of[undefined,NaN,-0]){const value={...row,receipt:{...row.receipt,png:{...row.receipt.png,width:bad}}};expect(rowObjectReferences('workspace_furnishing_thumbnail_candidates',value).issues).toContainEqual(expect.objectContaining({code:'INVALID_FURNISHING_THUMBNAIL_CANDIDATE'}));}
});

it('binds stored selection request digest to exact candidate/model/receipt/request and previous event version',()=>{
 const {selection}=fixture();for(const change of[{furnishing_id:uuid(30)},{candidate_id:uuid(31)},{receipt_sha256:'c'.repeat(64)},{request_id:uuid(32)},{version:2},{request_sha256:'d'.repeat(64)}])expect(rowObjectReferences('workspace_furnishing_thumbnail_selections',{...selection,...change}).issues).toContainEqual(expect.objectContaining({code:'INVALID_FURNISHING_THUMBNAIL_SELECTION'}));
 for(const version of[1,2,2147483647]){const request={furnishingId:selection.furnishing_id,furnishingVersion:1,requestId:selection.request_id,candidateId:selection.candidate_id,receiptSha256:selection.receipt_sha256,expectedSelectionVersion:version-1};expect(rowObjectReferences('workspace_furnishing_thumbnail_selections',{...selection,version,request_sha256:digest(request)})).toEqual({references:[],issues:[]});}
 for(const version of[0,1.5,2147483648,Number.MAX_SAFE_INTEGER+1])expect(rowObjectReferences('workspace_furnishing_thumbnail_selections',{...selection,version}).issues).toContainEqual(expect.objectContaining({code:'INVALID_FURNISHING_THUMBNAIL_SELECTION'}));
});
