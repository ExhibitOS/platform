// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {afterEach,expect,test,vi} from 'vitest';
import {currentBrowserPublication,readBrowserPublication} from './browser-publication-source';
import type {PublicPublication} from './publication-client';
import {loadStaticPublication,verifiedClosedBoxShadowSource} from './static-publication-source';
import {fetchVerifiedAsset,isVerifiedPublicationGlb,MemoryAssetCache} from './viewer/loading';

const publicationId='e2000000-0000-4000-8000-000000000001';
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const binary=Uint8Array.of(34,56,78,12);
async function sample(){
 const exhibition=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 const light=exhibition.lights[0]!;
 exhibition.lights=[{...light,type:'spot',beamAngle:1.10,castsShadow:true}];
 const artwork=exhibition.artworks.find(row=>row.artworkType==='sculpture')!,inventory=artwork.assets[0]!;
 Object.assign(inventory,{bytes:binary.byteLength,sha256:hash(binary)});
 const post:PublicPublication={
   publication:{id:publicationId,revisionSha256:hash(freezeCanonical(exhibition)),status:'published',publishedAt:'2026-10-01T00:00:00Z'},
   exhibition,assets:[{assetId:inventory.id,mime:inventory.mime,url:`/api/v1/publications/${publicationId}/assets/${inventory.id}`}],
 };
 const proof={publicationId,publicationRevision:post.publication.revisionSha256,artworkRevisionId:artwork.revisionId,
   assetId:inventory.id,sha256:inventory.sha256,bytes:inventory.bytes};
 return {post,proof,inventory};
}

afterEach(()=>vi.unstubAllGlobals());

test('only the current validated browser response joins the ordinary member and its genuine cached buffer',async()=>{
 const {post,proof,inventory}=await sample();
 let active=true;
 const callback=vi.fn(async (path:unknown)=>{
   if(path===`/api/v1/publications/${publicationId}?footsteps=1`)return Response.json({...post,local:{shouldNotBecomeAnOwner:true}});
   if(path===post.assets[0]!.url)return new Response(binary,{headers:{'content-type':inventory.mime,'x-exhibitos-publication-revision':proof.publicationRevision}});
   return new Response(null,{status:404});
 });
 vi.stubGlobal('fetch',callback);
 const response=await readBrowserPublication(publicationId,()=>active);
 expect(response.local).toBeUndefined();
 expect(callback.mock.calls[0]?.[0]).toBe(`/api/v1/publications/${publicationId}?footsteps=1`);
 expect(verifiedClosedBoxShadowSource({...response},response.exhibition)).toBeUndefined();
 const member=verifiedClosedBoxShadowSource(response,response.exhibition);
 expect(member?.({...proof,bytes:5})).toBeUndefined();
 const current=member?.(proof);
 expect(current?.()).toBe(true);
 const identity={publicationId,revisionSha256:proof.publicationRevision,assetId:inventory.id,sha256:inventory.sha256,bytes:inventory.bytes};
 const body=await fetchVerifiedAsset({publicationId,revisionSha256:identity.revisionSha256,asset:response.assets[0]!,inventory,signal:new AbortController().signal});
 const cache=new MemoryAssetCache<ArrayBuffer>(32);cache.set(inventory.id,body,body.byteLength);
 expect(await isVerifiedPublicationGlb(cache.get(inventory.id)!,identity)).toBe(true);
 expect(await isVerifiedPublicationGlb(body.slice(0),identity)).toBe(false);
 expect(await isVerifiedPublicationGlb(body,{...identity,publicationId:'e2000000-0000-4000-8000-000000000002'})).toBe(false);
 const view=new Uint8Array(body);view[0]=view[0]!^1;
 expect(await isVerifiedPublicationGlb(cache.get(inventory.id)!,identity)).toBe(false);
 expect(callback).toHaveBeenCalledTimes(2);
 active=false;expect(current?.()).toBe(false);
 expect(currentBrowserPublication(response,response.exhibition)).toBeUndefined();
});

test('bounded original room, member, rights and spot stamps fail closed without walking unrelated authored data',async()=>{
 const {post,proof}=await sample();
 let generation=1;
 vi.stubGlobal('fetch',async()=>Response.json(post));
 const original=await readBrowserPublication(publicationId,()=>generation===1);
 const scene=original.exhibition, placement=scene.placements.find(row=>row.assetId===proof.assetId)!;
 const room=scene.rooms.find(row=>row.id===placement.roomId)!,light=scene.lights[0]!;
 const artwork=scene.artworks.find(row=>row.revisionId===proof.artworkRevisionId)!,asset=artwork.assets[0]!;
 const use=verifiedClosedBoxShadowSource(original,scene)?.(proof,placement);
 const current=()=>use?.(light.id);
 expect(current()).toBe(true);
 expect(use?.('other-light')).toBe(false);
 Object.defineProperty(scene,'title',{get(){throw Error('whole authored document was read in the depth fence');}});
 expect(current()).toBe(true);
 const originalX=placement.transform.position[0];
 placement.transform.position[0]=originalX+.1;
 expect(current()).toBe(false);
 placement.transform.position[0]=originalX;
 expect(Reflect.deleteProperty(placement.transform.position,0)).toBe(true);
 expect(current()).toBe(false);
 placement.transform.position[0]=originalX;
 const color=light.color[1];
 expect(Reflect.deleteProperty(light.color,1)).toBe(true);
 expect(current()).toBe(false);
 expect(verifiedClosedBoxShadowSource(original,scene)?.(proof,placement)?.(light.id)).toBe(false);
 light.color[1]=color;
 expect(current()).toBe(true);
 const originalZ=light.transform.position[2];
 light.transform.position[2]=originalZ+.1;
 expect(current()).toBe(false);
 light.transform.position[2]=originalZ;
 const width=room.dimensions.width;
 room.dimensions.width=width+.1;
 expect(current()).toBe(false);
 room.dimensions.width=width;
 asset.sha256='e'.repeat(64);
 expect(current()).toBe(false);
 asset.sha256=proof.sha256;
 artwork.rights.permissions.display=false;
 expect(current()).toBe(false);
 artwork.rights.permissions.display=true;
 expect(current()).toBe(true);
 // Replacing the authoritative projection or request generation retires the old fence.
 original.assets[0]={...original.assets[0]!};
 expect(current()).toBe(false);
 generation=2;
 const next=await readBrowserPublication(publicationId,()=>generation===2);
 const nextPlacement=next.exhibition.placements.find(row=>row.assetId===proof.assetId)!;
 expect(verifiedClosedBoxShadowSource(next,next.exhibition)?.(proof,nextPlacement)?.(light.id)).toBe(true);
 expect(current()).toBe(false);
});

test('hash mismatch preserves ordinary viewing and does not authorize closed-box depth',async()=>{
 const {post}=await sample();
 post.publication.revisionSha256='e'.repeat(64);
 vi.stubGlobal('fetch',async()=>Response.json(post));
 const response=await readBrowserPublication(publicationId,()=>true);
 expect(response.publication.revisionSha256).toBe(post.publication.revisionSha256);
 expect(currentBrowserPublication(response,response.exhibition)).toBeUndefined();
});

test('current static ordinary member joins only its verified index and original metadata',async()=>{
 const {post,proof,inventory}=await sample();
 const body=JSON.stringify(post),bodySha=hash(body),bodyPath=`data/${bodySha}.json`;
 const indexFor=(sha256:string)=>JSON.stringify({version:1,
   publication:{path:bodyPath,bytes:Buffer.byteLength(body),sha256:bodySha,mime:'application/json'},
   assets:[{assetId:inventory.id,path:`data/${sha256}.bin`,bytes:inventory.bytes,sha256,mime:inventory.mime}],
 });
 let index=indexFor(inventory.sha256);
 const document={querySelector:()=>meta};
 const meta={name:'exhibitos-static-index',content:hash(index),isConnected:true,ownerDocument:document};
 vi.stubGlobal('document',document);
 const fetcher=vi.fn(async(path:unknown)=>path==='/static-publication-index.json'?new Response(index):
   path==='/'+bodyPath?new Response(body):new Response(null,{status:404}));
 vi.stubGlobal('fetch',fetcher);
 const publication=await loadStaticPublication();
 const mounted=verifiedClosedBoxShadowSource(publication,publication.exhibition)?.(proof);
 expect(mounted?.()).toBe(true);
 expect(verifiedClosedBoxShadowSource({...publication},publication.exhibition)).toBeUndefined();
 meta.isConnected=false;expect(mounted?.()).toBe(false);
 meta.isConnected=true;expect(mounted?.()).toBe(true);
 index=indexFor('f'.repeat(64));meta.content=hash(index);
 expect(mounted?.()).toBe(false);
 const later=await loadStaticPublication();
 expect(verifiedClosedBoxShadowSource(later,later.exhibition)?.(proof)).toBeUndefined();
 expect(fetcher.mock.calls.map(([path])=>path)).toEqual([
   '/static-publication-index.json','/'+bodyPath,'/static-publication-index.json','/'+bodyPath,
 ]);
});
