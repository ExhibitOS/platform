// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
import {validateThumbnailBytes} from './artwork-thumbnail.ts';
vi.mock('./artwork-thumbnail.ts',async original=>({...await original<typeof import('./artwork-thumbnail.ts')>(),validateThumbnailBytes:vi.fn(async()=>({width:256,height:256}))}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rights={holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:false,export:false,commercial:false},creditLine:'Synthetic'};
function fixture(){
 const metadata={title:'Synthetic',description:'',dimensions:{width:1,height:1,unit:'m'},rights,provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:''}};
 const original=Buffer.alloc(28,1),display=Buffer.alloc(32,2),png=Buffer.from('synthetic reviewed PNG');
 const source={id:id(3),sha256:sha256(original),bytes:original.length,mime:'model/gltf-binary',object_key:'source',rights_id:id(7),rights};
 const art={revision:1,approved_revision:1,approved_asset_id:source.id,metadata};
 const assets=new Map<string,Record<string,unknown>>([[source.id,source]]),bytes=new Map([['source',original]]),bindings:Record<string,unknown>[]=[];
 let selection:{binding_id:string;version:number}|undefined;
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.startsWith('SELECT snapshot'))return {rows:[{snapshot:{metadata,asset:source}}]};
  if(sql.startsWith('SELECT a.*,r.metadata AS rights'))return {rows:[assets.get(String(args[2]))].filter(Boolean)};
  if(sql.includes('FROM artwork_thumbnail_bindings WHERE'))return {rows:bindings.filter(b=>b.request_id===args[2])};
  if(sql.startsWith('SELECT binding_id,version'))return {rows:selection?[selection]:[]};
  if(sql.startsWith('INSERT INTO assets'))assets.set(String(args[1]),{id:args[1],rights,sha256:args[5],bytes:args[6],mime:'image/png',object_key:args[4]});
  if(sql.startsWith('INSERT INTO artwork_thumbnail_bindings'))bindings.push({id:args[1],thumbnail_asset_id:args[6],selection_version:args[7],sha256:args[8],bytes:args[9],object_key:args[10],recipe:args[12],request_id:args[14],payload_sha256:args[15]});
  if(sql.startsWith('INSERT INTO artwork_thumbnail_selections'))selection={binding_id:String(args[4]),version:Number(args[3])};
  return {rows:[],rowCount:1};
 });
 const put=vi.fn(async(key:string,value:Uint8Array)=>{const prior=bytes.get(key);if(prior&&!prior.equals(value))throw Error('immutable');bytes.set(key,Buffer.from(value));});
 const bounded=vi.fn(async(key:string,n:number)=>{const b=bytes.get(key);if(!b||b.length!==n)throw Error('size');return b;});
 const store={get:async(key:string)=>bytes.get(key)!,getBounded:bounded,putDurable:put} as unknown as BlobStore;
 const service=new ArtworkThumbnailReceipts(store);
 vi.spyOn(service.cms,'ownArtwork').mockResolvedValue(art);
 const preview=vi.spyOn(service.cms,'display').mockResolvedValue({bytes:display,mime:'model/gltf-binary',revision:1} as never);
 const input={kind:'rendered-display-preview-v1',requestId:id(6),expectedRevision:1,expectedSelectionVersion:0,sourceAssetId:source.id,sourceSha256:source.sha256,displaySha256:sha256(display),pngSha256:sha256(png),pngBase64:png.toString('base64'),view:{kind:'default'}};
 return {service,c:{query} as unknown as PoolClient,s:{tenantId:id(1),userId:id(5),role:'artist'} as Session,input,art,source,png,put,bounded,query,bindings,preview,bytes,advance:()=>{selection={binding_id:id(99),version:2};}};
}
it('persists the reviewed bytes once, with separate primary/display hashes and immutable recipe; replay returns the same asset',async()=>{
 const f=fixture(),before=structuredClone(f.art);
 const first=await f.service.selectRendered(f.c,f.s,id(2),f.input);
 expect(first).toMatchObject({selected:true,selectionVersion:1,thumbnailSha256:f.input.pngSha256});
 expect(first.thumbnailAssetId).not.toBe(f.source.id);expect(f.put).toHaveBeenCalledTimes(1);
 expect(f.bindings[0]!.recipe).toMatchObject({recipeId:'artwork-glb-card-256-v1',source:{sha256:f.input.sourceSha256},display:{sha256:f.input.displaySha256},output:{width:256,height:256}});
 expect(await f.service.selectRendered(f.c,f.s,id(2),f.input)).toEqual(first);
 expect(f.bindings).toHaveLength(1);expect(f.put).toHaveBeenCalledTimes(1);expect(f.art).toEqual(before);
 f.advance();expect(await f.service.selectRendered(f.c,f.s,id(2),f.input)).toEqual({...first,selected:false});
 await expect(f.service.selectRendered(f.c,f.s,id(2),{...f.input,expectedSelectionVersion:1})).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
});
it('rejects stale authority, source/display substitution, hash mismatch and stale CAS without storing pixels',async()=>{
 const f=fixture();
 for(const value of [{...f.input,pngSha256:'f'.repeat(64)},{...f.input,sourceSha256:'f'.repeat(64)},{...f.input,displaySha256:'f'.repeat(64)},{...f.input,expectedSelectionVersion:1}])await expect(f.service.selectRendered(f.c,f.s,id(2),value)).rejects.toThrow();
 f.art.revision=2;await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 expect(f.put).not.toHaveBeenCalled();expect(f.bindings).toHaveLength(0);
});
it('fails closed for wrong dimensions, storage failure, corrupt stored bytes and rights revoked during I/O',async()=>{
 const f=fixture();
 vi.mocked(validateThumbnailBytes).mockResolvedValueOnce({width:256,height:128});
 await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toMatchObject({code:'ARTWORK_THUMBNAIL_INVALID'});expect(f.put).not.toHaveBeenCalled();
 f.put.mockRejectedValueOnce(Error('disk failure'));await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toThrow('disk failure');
 f.bounded.mockResolvedValueOnce(Buffer.alloc(f.png.length));await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 f.put.mockImplementationOnce(async()=>{f.source.rights={...rights,permissions:{...rights.permissions,display:false}};});
 await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toMatchObject({code:'RIGHTS_DENIED'});expect(f.bindings).toHaveLength(0);
});
it('reuses immutable orphan bytes after a failed asset transaction instead of generating another blob key',async()=>{
 const f=fixture(),base=f.query.getMockImplementation()!;let fail=true;
 f.query.mockImplementation(async(sql,args)=>{if(fail&&sql.startsWith('INSERT INTO assets')){fail=false;throw Error('SQL failed');}return base(sql,args);});
 await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).rejects.toThrow('SQL failed');
 await expect(f.service.selectRendered(f.c,f.s,id(2),f.input)).resolves.toMatchObject({selected:true});
 expect(f.put.mock.calls[0]![0]).toBe(f.put.mock.calls[1]![0]);expect(f.bindings).toHaveLength(1);
});
