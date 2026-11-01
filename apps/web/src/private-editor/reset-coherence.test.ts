// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import type {PublicPublication} from '../publication-client';
import type {LocalDraft} from '../drafts/store';
import {validateDraft} from '../drafts/validator';
import {preparePrivateReset,preparePrivateSave} from '../PrivateExhibitionEditor';
import {privateSeed,starterDraft} from './model';

function fixture(){
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 const source:PublicPublication={...JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')),local:{kind:'static',fetcher:async()=>{throw Error('No asset IO');},check:async()=>{}}};
 const seed=privateSeed(source,'a'.repeat(64)),draft=starterDraft(seed),old:LocalDraft={id:draft.id,format:2,version:1,draft,updatedAt:draft.updatedAt};
 return {source,seed,old};
}
it('keeps a saved reset coherent and preserves known copies when the following list read fails',async()=>{
 const f=fixture(),before={source:structuredClone(f.source.exhibition),old:structuredClone(f.old)},known=[f.old],save=vi.fn(async(draft:LocalDraft['draft']):Promise<LocalDraft>=>({id:draft.id,format:2,version:1,draft,updatedAt:draft.updatedAt})),list=vi.fn(async():Promise<LocalDraft[]>=>{throw Error('read failed after committed save');});
 const next=await preparePrivateReset(f.seed,{save,list},known);
 expect(next.record.id).not.toBe(f.old.id);expect(next.record.draft.exhibitionId).toBe(next.geometry.present.id);expect(validateDraft({...next.record.draft,candidate:next.geometry.present}).valid).toBe(true);
 expect(next.copies).toEqual([next.record,f.old]);expect(next.listRefreshed).toBe(false);expect(save).toHaveBeenCalledOnce();expect(list).toHaveBeenCalledOnce();expect(f.source.exhibition).toEqual(before.source);expect(f.old).toEqual(before.old);expect(known).toEqual([before.old]);
});
it('retains the current copy and does not list when saving a reset fails',async()=>{
 const f=fixture(),before=structuredClone(f.old),save=vi.fn(async():Promise<LocalDraft>=>{throw Error('save failed');}),list=vi.fn(async()=>[f.old]);
 await expect(preparePrivateReset(f.seed,{save,list},[f.old])).rejects.toThrow('save failed');expect(list).not.toHaveBeenCalled();expect(f.old).toEqual(before);
});
it('uses the actual refreshed copies and includes the selected new record exactly once',async()=>{
 const f=fixture();let saved:LocalDraft;
 const save=vi.fn(async(draft:LocalDraft['draft']):Promise<LocalDraft>=>saved={id:draft.id,format:2,version:1,draft,updatedAt:draft.updatedAt}),list=vi.fn(async()=>[saved,f.old]);
 const next=await preparePrivateReset(f.seed,{save,list},[f.old]);expect(next.copies).toEqual([next.record,f.old]);expect(next.listRefreshed).toBe(true);expect(next.geometry.present).toEqual(next.record.draft.candidate);expect(validateDraft(next.record.draft).valid).toBe(true);
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
it('retains the saved version when a following reset also cannot refresh the list',async()=>{
 const f=fixture(),saved={...f.old,version:2,draft:{...f.old.draft,editVersion:2}},list=vi.fn(async():Promise<LocalDraft[]>=>{throw Error('list failed');});
 const saveCurrent=vi.fn(async()=>saved),current=await preparePrivateSave(f.seed,{save:saveCurrent,list},f.old,f.old.draft.candidate,[f.old]);
 const saveNew=vi.fn(async(draft:LocalDraft['draft']):Promise<LocalDraft>=>({id:draft.id,format:2,version:1,draft,updatedAt:draft.updatedAt}));
 const reset=await preparePrivateReset(f.seed,{save:saveNew,list},current.copies);
 expect(reset.copies).toEqual([reset.record,saved]);expect(reset.listRefreshed).toBe(false);
});
