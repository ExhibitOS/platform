// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import type {PublicPublication} from '../publication-client';
import type {LocalDraft} from '../drafts/store';
import {validateDraft} from '../drafts/validator';
import {preparePrivateReset,preparePrivateSave,preparePrivateRecovery} from '../PrivateExhibitionEditor';
import {privateSeed,starterDraft} from './model';

function fixture(){
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 const source:PublicPublication={...JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')),local:{kind:'static',fetcher:async()=>{throw Error('No asset IO');},check:async()=>{}}};
 const seed=privateSeed(source,'a'.repeat(64)),draft=starterDraft(seed),old:LocalDraft={id:draft.id,format:2,version:1,draft,updatedAt:draft.updatedAt};
 return {source,seed,old};
}
it('resets the current identity coherently, preserving unsaved previous input when list refresh fails',async()=>{
 const f=fixture(),before=structuredClone(f.old),candidate={...f.old.draft.candidate,title:'저장하지 않은 편집'},known=[f.old];
 const resetPrivate=vi.fn(async(current:LocalDraft['draft'],reset:LocalDraft['draft'],expected:number):Promise<LocalDraft>=>{expect(current.candidate).toEqual(candidate);expect(expected).toBe(f.old.version);return {id:reset.id,format:2,version:3,draft:{...reset,editVersion:3},updatedAt:reset.updatedAt};});
 const list=vi.fn(async():Promise<LocalDraft[]>=>{throw Error('list failed');});
 const next=await preparePrivateReset(f.seed,{resetPrivate,list},f.old,candidate,known);
 expect(next.record.id).toBe(f.old.id);expect(next.record.draft.exhibitionId).toBe(f.old.draft.exhibitionId);expect(next.geometry.present.title).toBe(f.source.exhibition.title);expect(validateDraft(next.record.draft).valid).toBe(true);expect(next.copies).toEqual([next.record]);expect(next.listRefreshed).toBe(false);expect(resetPrivate).toHaveBeenCalledOnce();expect(f.old).toEqual(before);
});
it('does not list or replace editing state when atomic reset fails',async()=>{
 const f=fixture(),before=structuredClone(f.old),resetPrivate=vi.fn(async():Promise<LocalDraft>=>{throw Error('LOCAL_CONFLICT');}),list=vi.fn(async()=>[f.old]);
 await expect(preparePrivateReset(f.seed,{resetPrivate,list},f.old,f.old.draft.candidate,[f.old])).rejects.toThrow('LOCAL_CONFLICT');expect(list).not.toHaveBeenCalled();expect(f.old).toEqual(before);
});
it('retains other copies while selecting the committed current reset exactly once',async()=>{
 const f=fixture();let saved:LocalDraft;const other={...f.old,id:crypto.randomUUID()};
 const resetPrivate=vi.fn(async(_current:LocalDraft['draft'],draft:LocalDraft['draft']):Promise<LocalDraft>=>saved={id:draft.id,format:2,version:3,draft:{...draft,editVersion:3},updatedAt:draft.updatedAt}),list=vi.fn(async()=>[saved,other]);
 const next=await preparePrivateReset(f.seed,{resetPrivate,list},f.old,f.old.draft.candidate,[f.old,other]);expect(next.copies).toEqual([next.record,other]);expect(next.listRefreshed).toBe(true);expect(next.geometry.present).toEqual(next.record.draft.candidate);expect(validateDraft(next.record.draft).valid).toBe(true);
});

it('reports the committed save even when the copy list cannot be refreshed',async()=>{
 const f=fixture(),before=structuredClone(f.old),known=[f.old],saved={...f.old,version:2,draft:{...f.old.draft,editVersion:2}};
 const save=vi.fn(async()=>saved),list=vi.fn(async():Promise<LocalDraft[]>=>{throw Error('list failed');});
 const result=await preparePrivateSave(f.seed,{save,list},f.old,f.old.draft.candidate,known);
 expect(save).toHaveBeenCalledWith(f.old.draft,1);expect(result).toEqual({record:saved,copies:[saved],listRefreshed:false});
 expect(f.old).toEqual(before);expect(known).toEqual([before]);
});
it('does not refresh the list or replace the current record when save fails',async()=>{
 const f=fixture(),before=structuredClone(f.old),save=vi.fn(async():Promise<LocalDraft>=>{throw Error('save failed');}),list=vi.fn(async()=>[f.old]);
 await expect(preparePrivateSave(f.seed,{save,list},f.old,f.old.draft.candidate,[f.old])).rejects.toThrow('save failed');
 expect(list).not.toHaveBeenCalled();expect(f.old).toEqual(before);
});
it('uses refreshed copies while retaining the newly committed version exactly once',async()=>{
 const f=fixture(),saved={...f.old,version:2,draft:{...f.old.draft,editVersion:2}},other={...f.old,id:crypto.randomUUID()};
 const save=vi.fn(async()=>saved),list=vi.fn(async()=>[f.old,other]);
 const result=await preparePrivateSave(f.seed,{save,list},f.old,f.old.draft.candidate,[f.old]);
 expect(result).toEqual({record:saved,copies:[saved,other],listRefreshed:true});
});
it('validates previous source assets before asking the store to recover',async()=>{
 const f=fixture(),bad=structuredClone(f.old);bad.draft.candidate.artworks[0]!.assets[0]!.sha256='0'.repeat(64);
 const privatePrevious=vi.fn(async()=>bad),recoverPrivate=vi.fn(async()=>f.old),list=vi.fn(async()=>[f.old]);
 await expect(preparePrivateRecovery(f.seed,{privatePrevious,recoverPrivate,list},f.old,f.old.draft.candidate,[f.old])).rejects.toThrow();expect(recoverPrivate).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
});
it('recovers the verified previous version with CAS and keeps the committed result if listing fails',async()=>{
 const f=fixture(),previous={...f.old,version:2,draft:{...f.old.draft,editVersion:2}},candidate={...f.old.draft.candidate,title:'현재 저장하지 않은 편집'},saved={...f.old,version:4,draft:{...f.old.draft,editVersion:4}};
 const privatePrevious=vi.fn(async()=>previous),recoverPrivate=vi.fn(async()=>saved),list=vi.fn(async():Promise<LocalDraft[]>=>{throw Error('list failed');});
 const next=await preparePrivateRecovery(f.seed,{privatePrevious,recoverPrivate,list},f.old,candidate,[f.old]);
 expect(recoverPrivate).toHaveBeenCalledWith({...f.old.draft,candidate},f.old.version,previous.version);expect(next.record).toBe(saved);expect(next.copies).toEqual([saved]);expect(next.geometry.present).toEqual(saved.draft.candidate);expect(next.listRefreshed).toBe(false);
});
