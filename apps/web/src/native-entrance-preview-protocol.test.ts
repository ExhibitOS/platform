// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedEntrancePreviewRequest,entrancePreviewReply,entrancePreviewStateMatches,type EntrancePreviewRequest,type EntrancePreviewGeometry} from './native-entrance-preview-protocol';
function sample(){
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:true};
 const request:EntrancePreviewRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'show',device:'desktop',scenario:'normal',reducedMotion:false,theme:null,locale:null};
 const geometry:EntrancePreviewGeometry={renderGeneration:1,imageStatus:'absent',viewport:{width:1024,height:740},snapshotRect:{x:0,y:0,width:1024,height:740}};
 return {frame,request,geometry};
}
it('allows disabled-frame readonly preview and returns full independent draft with explicit nullable echoes',()=>{
 const {frame,request,geometry}=sample(),before=structuredClone(frame);
 expect(checkedEntrancePreviewRequest(request,frame)).toEqual(request);
 const reply=entrancePreviewReply(request,frame,geometry);expect(reply.baseDraft).toEqual(frame.draft);expect(reply.baseDraft).not.toBe(frame.draft);expect(reply.theme).toBeNull();expect(reply.locale).toBeNull();expect(reply.mode).toBe('cover');
 reply.baseDraft.candidate.title='Preview copy';expect(frame).toEqual(before);
 expect(entrancePreviewReply({...request,type:'close'},frame,geometry).mode).toBe('editor');
});
it('refuses missing nullable fields, unknown fields, invalid options and stale scope without changing input',()=>{
 const {frame,request}=sample(),before=structuredClone(frame),{locale,...missingLocale}=request,{theme,...missingTheme}=request;void locale;void theme;
 for(const invalid of [missingLocale,missingTheme,{...request,extra:true},{...request,theme:'future'},{...request,locale:'en_US'},{...request,reducedMotion:0},{...request,type:'save'},{...request,requestId:'invalid'}])expect(()=>checkedEntrancePreviewRequest(invalid,frame)).toThrow('ENTRANCE_PREVIEW_INVALID');
 for(const invalid of [{...request,epoch:crypto.randomUUID()},{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,principalId:crypto.randomUUID()}])expect(()=>checkedEntrancePreviewRequest(invalid,frame)).toThrow('ENTRANCE_PREVIEW_STALE');
 expect(frame).toEqual(before);
});
it('rejects unbounded or nonfinite snapshots and checks original options, full source and measured generation read-only',()=>{
 const {frame,request,geometry}=sample(),reply=entrancePreviewReply(request,frame,geometry),before=structuredClone(reply);
 for(const snapshotRect of [{x:-1,y:0,width:1,height:1},{x:0,y:0,width:1025,height:740},{x:0,y:0,width:1,height:NaN},{x:0,y:0,width:0,height:1}])expect(()=>entrancePreviewReply(request,frame,{...geometry,snapshotRect})).toThrow('ENTRANCE_PREVIEW_BOUNDS');
 const matches=(r=request,f=frame,g=geometry)=>entrancePreviewStateMatches(request,r,f,reply,g);
 expect(matches()).toBe(true);expect(matches({...request,type:'thumbnail'})).toBe(false);expect(matches({...request,locale:'ko'})).toBe(false);expect(matches(request,frame,{...geometry,renderGeneration:2})).toBe(false);
 expect(matches(request,{...frame,draft:{...frame.draft,candidate:{...frame.draft.candidate,title:'Changed'}}})).toBe(false);expect(reply).toEqual(before);
});
