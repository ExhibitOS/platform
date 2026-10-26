// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {MAX_COVER_BYTES} from '@exhibitos/studio-contract';
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
it('uses only approved watermarked display bytes, checks scope and current approval again, and leaves the draft intact',async()=>{
 const {frame,artwork,headers,check}=fixture(),before=structuredClone(frame),paths:string[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{const path=String(input);paths.push(path);expect(options).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'});return path.includes('/studio/')?Response.json({artwork}):new Response(new Uint8Array([1,2,3]),{headers});});
 const bytes=await nativeEntranceCoverSource(frame,check,fetcher).image(artwork.primaryAssetId,new AbortController().signal);
 expect([...new Uint8Array(bytes)]).toEqual([1,2,3]);expect(paths).toEqual([`/api/v1/tenants/${frame.tenantId}/studio/artworks/${artwork.id}`,`/api/v1/tenants/${frame.tenantId}/cms/artworks/${artwork.id}/preview?expectedRevision=${artwork.revision}`,paths[0]]);expect(check).toHaveBeenCalledTimes(2);expect(frame).toEqual(before);
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
