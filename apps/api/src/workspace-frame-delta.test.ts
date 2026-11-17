// SPDX-License-Identifier: AGPL-3.0-or-later
import {strict as assert} from 'node:assert';
import {it as test} from 'vitest';
import {ordinaryFrameDelta} from './workspace-frame-delta.ts';
import type {Draft} from './studio.ts';
const namespace='org.exhibitos.studio/workspace-furnishings';
const base=()=>({id:'draft',editVersion:1,updatedAt:'a',candidate:{title:'unchanged',extensions:{other:{value:1}}}}) as unknown as Draft;
const add=(draft:Draft)=>{const result=structuredClone(draft),extensions=result.candidate.extensions!;extensions[namespace]={version:4,furnishings:[{id:'frame',kind:'artwork-frame'}],placements:[],frameAttachments:[{placementId:'placement',furnishingId:'frame'}]} as never;result.editVersion++;result.updatedAt='b';return result;};
test('allows one frame attachment and its final detach only',()=>{const before=base(),after=add(before);assert.equal(ordinaryFrameDelta(before,after,namespace),true);assert.equal(ordinaryFrameDelta(after,before,namespace),true);assert.equal(ordinaryFrameDelta(after,after,namespace),false);});
test('rejects unrelated candidate changes and multiple attachment changes',()=>{const before=base(),after=add(before);after.candidate.title='changed';assert.equal(ordinaryFrameDelta(before,after,namespace),false);const more=add(before);const ext=more.candidate.extensions![namespace] as unknown as {frameAttachments:object[]};ext.frameAttachments.push({placementId:'other',furnishingId:'frame'});assert.equal(ordinaryFrameDelta(before,more,namespace),false);});
test('retains unrelated room furniture through attach',()=>{const before=base();before.candidate.extensions![namespace]={version:3,furnishings:[{id:'chair',kind:'stool'}],placements:[{id:'seat'}]} as never;const after=structuredClone(before);after.candidate.extensions![namespace]={version:4,furnishings:[{id:'chair',kind:'stool'},{id:'frame',kind:'artwork-frame'}],placements:[{id:'seat'}],frameAttachments:[{placementId:'p',furnishingId:'frame'}]} as never;assert.equal(ordinaryFrameDelta(before,after,namespace),true);const ext=after.candidate.extensions![namespace] as unknown as {placements:object[]};ext.placements=[];assert.equal(ordinaryFrameDelta(before,after,namespace),false);});
test('allows frame edits while preserving portal attachments and descriptors',()=>{const before=base();before.candidate.extensions![namespace]={version:6,furnishings:[{id:'portal',kind:'portal-finish'}],placements:[],frameAttachments:[],openingAttachments:[{openingId:'door',furnishingId:'portal'}]} as never;const after=structuredClone(before),ext=after.candidate.extensions![namespace] as unknown as {furnishings:object[];frameAttachments:object[];openingAttachments:object[]};ext.furnishings.push({id:'frame',kind:'artwork-frame'});ext.frameAttachments.push({placementId:'p',furnishingId:'frame'});assert.equal(ordinaryFrameDelta(before,after,namespace),true);assert.equal(ordinaryFrameDelta(after,before,namespace),true);ext.openingAttachments=[];assert.equal(ordinaryFrameDelta(before,after,namespace),false);});
test('rejects downgrade on final frame detach when room visuals remain',()=>{const before=base();before.candidate.extensions![namespace]={version:4,furnishings:[{id:'chair',kind:'stool'},{id:'frame',kind:'artwork-frame'}],placements:[{id:'seat'}],frameAttachments:[{placementId:'p',furnishingId:'frame'}]} as never;const after=structuredClone(before);after.candidate.extensions![namespace]={version:4,furnishings:[{id:'chair',kind:'stool'}],placements:[{id:'seat'}],frameAttachments:[]} as never;assert.equal(ordinaryFrameDelta(before,after,namespace),true);for(const version of [1,2,3]){after.candidate.extensions![namespace]={version,furnishings:[{id:'chair',kind:'stool'}],placements:[{id:'seat'}]} as never;assert.equal(ordinaryFrameDelta(before,after,namespace),false);}});
test('allows v4 to v5 upgrade but never silently downgrades a v5 document',()=>{
 const before=add(base()),after=structuredClone(before);(after.candidate.extensions![namespace] as {version:number}).version=5;
 const rows=(after.candidate.extensions![namespace] as {frameAttachments:{placementId:string}[]}).frameAttachments;rows[0]={...rows[0]!,placementId:'new-target'};
 assert.equal(ordinaryFrameDelta(before,after,namespace),false); // Two attachment targets changed.
 rows[0]={...rows[0]!,placementId:'placement',furnishingId:'different'} as typeof rows[number];
 assert.equal(ordinaryFrameDelta(before,after,namespace),true);
 assert.equal(ordinaryFrameDelta(after,before,namespace),false);
});

test('allows one source-bound v9 frame edit while retaining portals and rejects reserved v8',()=>{
 const before=base();before.candidate.extensions![namespace]={version:7,furnishings:[{id:'portal',kind:'portal-finish'}],placements:[],frameAttachments:[],openingAttachments:[{openingId:'door',furnishingId:'portal'}]} as never;
 const after=structuredClone(before),ext=after.candidate.extensions![namespace] as unknown as {version:number;furnishings:object[];frameAttachments:object[];openingAttachments:object[]};ext.version=9;ext.furnishings.push({id:'miter',kind:'artwork-frame'});ext.frameAttachments.push({placementId:'image',furnishingId:'miter'});
 assert.equal(ordinaryFrameDelta(before,after,namespace),true);assert.equal(ordinaryFrameDelta(after,before,namespace),true);ext.version=8;assert.equal(ordinaryFrameDelta(before,after,namespace),false);ext.version=9;ext.openingAttachments=[];assert.equal(ordinaryFrameDelta(before,after,namespace),false);
});

const ceilingBase=()=>{
 const draft=base();
 draft.candidate.extensions![namespace]={
  version:11,
  furnishings:[{id:'rail',kind:'ceiling-rail'},{id:'portal',kind:'portal-finish'}],
  placements:[{id:'rail-placement',furnishingId:'rail'}],
  frameAttachments:[],
  openingAttachments:[{openingId:'door',furnishingId:'portal'}],
  ceilingAttachments:[
   {placementId:'rail-placement',surfaceId:'ceiling',anchor:[0,0],yaw:0,gap:0},
   {placementId:'other-rail',surfaceId:'other-ceiling',anchor:[1,2],yaw:1,gap:0},
  ],
 } as never;
 return draft;
};
type FrameVisuals={
 version:number;furnishings:{id:string;kind:string}[];placements:{id:string;furnishingId:string}[];
 frameAttachments:{placementId:string;furnishingId:string}[];
 openingAttachments:{openingId:string;furnishingId:string}[];
 ceilingAttachments:{placementId:string;surfaceId:string;anchor:number[];yaw:number;gap:number}[];
};
const visuals=(draft:Draft)=>draft.candidate.extensions![namespace] as unknown as FrameVisuals;
const addCeilingFrame=(before:Draft)=>{
 const after=structuredClone(before),ext=visuals(after);
 ext.furnishings.push({id:'frame',kind:'artwork-frame'});
 ext.frameAttachments.push({placementId:'painting',furnishingId:'frame'});
 after.editVersion++;after.updatedAt='b';
 return after;
};
test('allows v11 frame attach, replacement and final detach while preserving both ceiling rails',()=>{
 const before=ceilingBase(),after=addCeilingFrame(before);
 assert.equal(ordinaryFrameDelta(before,after,namespace),true);
 assert.equal(ordinaryFrameDelta(after,before,namespace),true);
 const replacement=structuredClone(after);
 visuals(replacement).furnishings.push({id:'other-frame',kind:'artwork-frame'});
 visuals(replacement).frameAttachments[0]!.furnishingId='other-frame';
 assert.equal(ordinaryFrameDelta(after,replacement,namespace),true);
 assert.equal(ordinaryFrameDelta(after,after,namespace),false);
 assert.equal(visuals(before).ceilingAttachments.length,2);
});
test('rejects v11 rail, room visual, portal or unrelated document changes alongside a frame edit',()=>{
 const before=ceilingBase();
 const mutations:((after:Draft)=>void)[]=[
  after=>{visuals(after).ceilingAttachments[0]!.anchor[0]=3;},
  after=>{visuals(after).ceilingAttachments.pop();},
  after=>{visuals(after).placements[0]!.furnishingId='other';},
  after=>{visuals(after).furnishings[0]!.id='other-rail';},
  after=>{visuals(after).openingAttachments=[];},
  after=>{after.candidate.title='changed';},
  after=>{after.candidate.extensions!.other={value:2} as never;},
 ];
 for(const mutate of mutations){
  const after=addCeilingFrame(before);mutate(after);
  assert.equal(ordinaryFrameDelta(before,after,namespace),false);
 }
});
test('rejects v11 downgrades, missing ceiling arrays and multiple frame targets',()=>{
 const before=ceilingBase();
 for(const version of [4,5,6,7,9,10]){
  const after=addCeilingFrame(before);visuals(after).version=version;
  assert.equal(ordinaryFrameDelta(before,after,namespace),false);
 }
 const after=addCeilingFrame(before);
 delete (visuals(after) as Partial<FrameVisuals>).ceilingAttachments;
 assert.equal(ordinaryFrameDelta(before,after,namespace),false);
 const multiple=addCeilingFrame(before);
 visuals(multiple).frameAttachments.push({placementId:'other-painting',furnishingId:'frame'});
 assert.equal(ordinaryFrameDelta(before,multiple,namespace),false);
 const empty=ceilingBase();visuals(empty).ceilingAttachments=[];
 const downgrade=addCeilingFrame(empty);visuals(downgrade).version=10;
 assert.equal(ordinaryFrameDelta(empty,downgrade,namespace),false);
});
test('compares additional extension fields instead of silently discarding them during a frame edit',()=>{
 const before=ceilingBase(),after=addCeilingFrame(before);
 (after.candidate.extensions![namespace] as unknown as Record<string,unknown>).unexpected={changed:true};
 assert.equal(ordinaryFrameDelta(before,after,namespace),false);
});
