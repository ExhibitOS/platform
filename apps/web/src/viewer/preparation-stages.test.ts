// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {createPreparationStages} from './preparation-stages';
type Artwork=Parameters<typeof createPreparationStages>[0][number];
const asset='aaaaaaaa-0000-4000-8000-000000000001',revision='bbbbbbbb-0000-4000-8000-000000000001';
const art=(revisionId=revision,ids=[asset])=>({revisionId,assets:ids.map(id=>({id}))}) as Artwork;
it('binds only unique admitted artwork identities, normalizing UUID case and duplicate references',()=>{
 const unique=createPreparationStages([art(revision,[asset,asset.toUpperCase()])]);unique.begin(asset.toUpperCase(),'one');expect(unique.snapshot()[0]).toMatchObject({assetId:asset,artworkRevisionId:revision,errorCode:null});
 const shared=createPreparationStages([art(),art('cccccccc-0000-4000-8000-000000000001',[asset.toUpperCase()])]);shared.begin(asset,'two');expect(shared.snapshot()[0]?.artworkRevisionId).toBeNull();
 shared.begin('dddddddd-0000-4000-8000-000000000001','unknown');expect(shared.snapshot()).toHaveLength(1);
});
it('publishes bounded exact exception tokens and clears them on progress, success and cancellation',()=>{
 const stages=createPreparationStages([art()]);stages.begin(asset,'one');
 stages.record(asset,'failed',new Error('ASSET_TRANSITION_PEAK'),'one');expect(stages.snapshot()[0]?.errorCode).toBe('ASSET_TRANSITION_PEAK');
 for(const message of ['/Users/private/file.glb','https://example.invalid/private','Error: failure\n at private', 'lowercase', 'A'.repeat(81)]){stages.record(asset,'failed',new Error(message),'one');expect(stages.snapshot()[0]?.errorCode).toBeNull();}
 stages.record(asset,'failed',{message:'SHOULD_NOT_PROPAGATE'},'one');expect(stages.snapshot()[0]?.errorCode).toBeNull();
 stages.record(asset,'failed',new Error('A'.repeat(80)),'one');expect(stages.snapshot()[0]?.errorCode).toHaveLength(80);
 const aborted=new Error('ABORTED');aborted.name='AbortError';stages.record(asset,'failed',aborted,'one');expect(stages.snapshot()[0]?.errorCode).toBeNull();
 for(const stage of ['fetch-verify','display-attached-render-requested','cancelled-settled']){stages.record(asset,stage,stage==='cancelled-settled'?new Error('ABORTED'):undefined,'one');expect(stages.snapshot()[0]?.errorCode).toBeNull();}
});
it('clears a prior failure at queue time and ignores old progress, cancellation and error after retry',()=>{
 const pending=new Set(['old']),stages=createPreparationStages([art()],()=>10,key=>pending.has(key));stages.begin(asset,'old');stages.record(asset,'failed',new Error('HASH_MISMATCH'),'old');
 pending.delete('old');pending.add('new');stages.begin(asset,'new');expect(stages.snapshot()[0]).toMatchObject({stage:'queued',errorCode:null});
 for(const value of ['fetch-verify','cancelled-settled','failed'])stages.record(asset,value,new Error('OLD_FAILURE'),'old');
 stages.record(asset,'evicted-preparation');expect(stages.snapshot()[0]).toMatchObject({stage:'queued',errorCode:null});
 stages.record(asset,'fetch-verify',undefined,'new');pending.delete('new');stages.record(asset,'display-attached-render-requested',undefined,'new');expect(stages.snapshot()[0]).toMatchObject({stage:'display-attached-render-requested',errorCode:null});
});
it('retains the latest 32 records while a still-current queued request can report after eviction',()=>{
 const ids=Array.from({length:35},(_,i)=>'aaaaaaaa-0000-4000-8000-'+String(i).padStart(12,'0')),pending=new Set(['first']);
 const stages=createPreparationStages([art(revision,ids)],()=>12,key=>pending.has(key));stages.begin(ids[0]!,'first');
 ids.slice(1).forEach((id,i)=>stages.begin(id,'next'+i));expect(stages.snapshot()).toHaveLength(32);expect(stages.snapshot().some(row=>row.assetId===ids[0])).toBe(false);
 stages.record(ids[0]!,'fetch-verify',undefined,'first');expect(stages.snapshot()).toHaveLength(32);expect(stages.snapshot().at(-1)).toMatchObject({assetId:ids[0],stage:'fetch-verify'});
 stages.record(ids[1]!,'failed',new Error('STALE'),'next0');expect(stages.snapshot().at(-1)?.assetId).toBe(ids[0]);
});
it('preserves existing timing fields and emits no request keys or raw exception text',()=>{
 let at=2;const stages=createPreparationStages([art()],()=>at);stages.begin(asset,'private-request-key');at=7;stages.record(asset,'fetch-verify',undefined,'private-request-key');
 expect(stages.snapshot()[0]).toEqual({assetId:asset,stage:'fetch-verify',at:7,durationsMs:{queued:5},artworkRevisionId:revision,errorCode:null});
 stages.record(asset,'/private/path',new Error('RAW'),'private-request-key');expect(stages.snapshot()[0]?.stage).toBe('fetch-verify');
});


it('forgets evicted queued cancellations without erasing a newer request generation',()=>{
 const ids=Array.from({length:66},(_,i)=>'aaaaaaaa-0000-4000-8000-'+String(i).padStart(12,'0')),pending=new Set<string>(),stages=createPreparationStages([art(revision,ids)],()=>20,key=>pending.has(key));
 ids.forEach((id,i)=>{pending.add('old'+i);stages.begin(id,'old'+i);});
 ids.slice(0,34).forEach((id,i)=>{pending.delete('old'+i);stages.settled(id,'old'+i);});
 stages.record(ids[0]!,'failed',new Error('LATE'),'old0');expect(stages.snapshot().some(row=>row.assetId===ids[0])).toBe(false);
 pending.add('new');stages.begin(ids[0]!,'new');ids.slice(34).forEach((id,i)=>stages.begin(id,'retry'+i));
 expect(stages.snapshot().some(row=>row.assetId===ids[0])).toBe(false);stages.settled(ids[0]!,'old0');stages.record(ids[0]!,'fetch-verify',undefined,'new');expect(stages.snapshot().at(-1)).toMatchObject({assetId:ids[0],stage:'fetch-verify'});
});
