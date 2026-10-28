// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {MAX_COVER_BYTES,SPACE_STILL_NAMESPACE,ENTRANCE_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {syntheticArtwork} from './placement/model';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {nativeEntranceCoverSource} from './native-entrance-cover-source';
function fixture(){
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:true},artwork=syntheticArtwork('image');
 artwork.extensions={'org.exhibitos.studio/cms':{tenantId:frame.tenantId,artworkId:artwork.id,revision:artwork.revision}};frame.draft.candidate.artworks=[artwork];
 const headers={'content-type':'image/png','x-exhibitos-watermarked':'true','x-exhibitos-artwork-revision':String(artwork.revision)},check=vi.fn(async(signal:AbortSignal)=>signal.throwIfAborted());
 return {frame,artwork,headers,check};
}
it('uses approved legacy display bytes, checks scope and current approval again, and leaves the draft intact',async()=>{
 const {frame,artwork,headers,check}=fixture(),before=structuredClone(frame),paths:string[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{const path=String(input);paths.push(path);expect(options).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'});return path.includes('/studio/')?Response.json({artwork}):new Response(new Uint8Array([1,2,3]),{headers});});
 const bytes=await nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,new AbortController().signal);
 expect([...new Uint8Array(bytes)]).toEqual([1,2,3]);expect(paths).toEqual([`/api/v1/tenants/${frame.tenantId}/studio/artworks/${artwork.id}`,`/api/v1/tenants/${frame.tenantId}/cms/artworks/${artwork.id}/preview?expectedRevision=${artwork.revision}`,paths[0]]);expect(check).toHaveBeenCalledTimes(2);expect(frame).toEqual(before);
});
it('accepts a clean approved display copy and rejects contradictory treatment markers',async()=>{
 for(const valid of [true,false]){
  const {frame,artwork,headers,check}=fixture(),cancel=vi.fn();
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/studio/')?Response.json({artwork}):new Response(valid?new Uint8Array([1,2,3]):new ReadableStream({cancel}),{headers:{...headers,'x-exhibitos-display-copy':'true','x-exhibitos-watermark-mode':'none','x-exhibitos-watermarked':valid?'false':'true'}}));
  const result=nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,new AbortController().signal);
  if(valid){expect([...new Uint8Array(await result)]).toEqual([1,2,3]);expect(check).toHaveBeenCalledTimes(2);}
  else{await expect(result).rejects.toThrow('ENTRANCE_PREVIEW_IMAGE_UNAVAILABLE');expect(cancel).toHaveBeenCalledOnce();}
 }
});
it('refuses revoked approval, missing watermark and post-download source changes before returning bytes',async()=>{
 for(const failure of ['denied','unmarked','changed'] as const){
  const {frame,artwork,headers,check}=fixture(),cancel=vi.fn();let metadataCalls=0;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
   if(String(input).includes('/studio/')){metadataCalls++;if(failure==='denied')return new Response(null,{status:403});return Response.json({artwork:failure==='changed'&&metadataCalls===2?{...artwork,metadata:{...artwork.metadata,title:'Changed'}}:artwork});}
   return new Response(failure==='unmarked'?new ReadableStream({cancel}):new Uint8Array([1]),{headers:failure==='unmarked'?{'content-type':'image/png','x-exhibitos-artwork-revision':String(artwork.revision)}:headers});
  });
  await expect(nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,new AbortController().signal)).rejects.toThrow();if(failure==='denied')expect(fetcher).toHaveBeenCalledTimes(1);if(failure==='unmarked')expect(cancel).toHaveBeenCalledOnce();
 }
});
it('cancels an oversized derivative stream and refuses an aborted owner',async()=>{
 const {frame,artwork,headers,check}=fixture(),cancel=vi.fn(),abort=new AbortController();let sent=false;
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/studio/')?Response.json({artwork}):new Response(new ReadableStream({pull(controller){if(!sent){sent=true;controller.enqueue(new Uint8Array(MAX_COVER_BYTES+1));}},cancel}),{headers}));
 await expect(nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,abort.signal)).rejects.toThrow('ENTRANCE_PREVIEW_IMAGE_LIMIT');expect(cancel).toHaveBeenCalledOnce();
 abort.abort();fetcher.mockClear();await expect(nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,abort.signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});

it('checks independent still current display rights after transfer and the final authentication await',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 try{for(const phase of ['ready','metadata','auth'] as const){
  vi.setSystemTime(new Date('2026-10-27T05:00:00Z'));
  const {frame}=fixture(),id=crypto.randomUUID(),asset={id,path:`space-still/${id}/image.png`,mime:'image/png',bytes:100,sha256:'a'.repeat(64),rights:{holder:'Synthetic creator',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic room',expiresAt:'2026-10-27T05:00:01Z'}};
  frame.draft.candidate.extensions={...frame.draft.candidate.extensions,[SPACE_STILL_NAMESPACE]:{version:1,asset},[ENTRANCE_NAMESPACE]:{version:1,artist:'Creator',introduction:'Space',imageAssetId:id,imageAlt:'Empty room',mobilePosition:'center'}};
  let metadataCalls=0,authCalls=0;
  const check=vi.fn(async(signal:AbortSignal)=>{signal.throwIfAborted();if(++authCalls===2&&phase==='auth')vi.setSystemTime(new Date(asset.rights.expiresAt));});
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
   if(String(input).includes('/preview?'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png','x-exhibitos-watermarked':'true','x-exhibitos-cover-sha256':asset.sha256}});
   if(++metadataCalls===2&&phase==='metadata')vi.setSystemTime(new Date(asset.rights.expiresAt));
   return Response.json({id,revision:1,state:'approved',revoked:false,asset});
  });
  const result=nativeEntranceCoverSource(frame,check,fetcher).image(id,new AbortController().signal);
  if(phase==='ready')expect([...new Uint8Array(await result)]).toEqual([1,2,3]);
  else await expect(result).rejects.toThrow('ENTRANCE_PREVIEW_IMAGE_RIGHTS');
  expect(metadataCalls).toBe(2);expect(authCalls).toBe(2);
 }}finally{vi.useRealTimers();}
});
