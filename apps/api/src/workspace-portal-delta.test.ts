// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Draft} from './studio.ts';
import {ordinaryPortalDelta} from './workspace-portal-delta.ts';
const ns='org.exhibitos.studio/workspace-furnishings';
const base=()=>({id:'draft',editVersion:1,updatedAt:'a',candidate:{title:'retained',extensions:{other:{value:1},[ns]:{version:5,furnishings:[{id:'frame',kind:'artwork-frame'}],placements:[],frameAttachments:[{placementId:'image',furnishingId:'frame'}]}}}}) as unknown as Draft;
const add=(draft:Draft)=>{const d=structuredClone(draft),ext=d.candidate.extensions![ns] as unknown as {version:number;furnishings:unknown[];openingAttachments:unknown[]};ext.version=6;ext.furnishings.push({id:'portal',kind:'portal-finish'});ext.openingAttachments=[{openingId:'door',furnishingId:'portal'}];d.editVersion++;d.updatedAt='b';return d;};
it('accepts one current-profile attach and final detach without other changes',()=>{const a=base(),b=add(a);expect(ordinaryPortalDelta(a,b,ns)).toBe(true);expect(ordinaryPortalDelta(b,a,ns)).toBe(true);expect(ordinaryPortalDelta(a,a,ns)).toBe(false);});
it('rejects unrelated changes, multiple attachments and unqualified older versions',()=>{const a=base(),b=add(a);b.candidate.title='changed';expect(ordinaryPortalDelta(a,b,ns)).toBe(false);const c=add(a),ext=c.candidate.extensions![ns] as unknown as {openingAttachments:unknown[]};ext.openingAttachments.push({openingId:'other',furnishingId:'portal'});expect(ordinaryPortalDelta(a,c,ns)).toBe(false);const old=base();(old.candidate.extensions![ns] as unknown as {version:number}).version=3;expect(ordinaryPortalDelta(old,add(old),ns)).toBe(false);});

it('retains a source-bound v9 frame while changing one portal and rejects reserved v8',()=>{
 const before=base(),left=before.candidate.extensions![ns] as unknown as {version:number;openingAttachments:unknown[]};left.version=9;left.openingAttachments=[];
 const after=add(before),right=after.candidate.extensions![ns] as unknown as {version:number;frameAttachments:unknown[]};right.version=9;
 expect(ordinaryPortalDelta(before,after,ns)).toBe(true);expect(ordinaryPortalDelta(after,before,ns)).toBe(true);right.version=8;expect(ordinaryPortalDelta(before,after,ns)).toBe(false);right.version=9;right.frameAttachments=[];expect(ordinaryPortalDelta(before,after,ns)).toBe(false);
});

function ceilingPortalDrafts(){
 const before=base();
 const ceilingAttachments=[{surfaceId:'ceiling',furnishingId:'rail'}];
 const extension=before.candidate.extensions![ns] as unknown as Record<string,unknown>;
 Object.assign(extension,{version:11,openingAttachments:[],ceilingAttachments});
 const after=add(before);
 const attached=after.candidate.extensions![ns] as unknown as Record<string,unknown>;
 attached.version=11;
 return {before,after,attached};
}

it('admits a v11 portal attach and detach with the same ceiling attachments',()=>{
 const {before,after}=ceilingPortalDrafts();
 expect(ordinaryPortalDelta(before,after,ns)).toBe(true);
 expect(ordinaryPortalDelta(after,before,ns)).toBe(true);
});

it.each([
 {version:11,ceilingAttachments:[{surfaceId:'ceiling',furnishingId:'other'}]},
 {version:11,ceilingAttachments:[]},
 {version:11,ceilingAttachments:undefined},
 {version:10,ceilingAttachments:undefined},
])('refuses a portal change with altered ceiling data or namespace downgrade (%j)',(changes)=>{
 const {before,after,attached}=ceilingPortalDrafts();
 Object.assign(attached,changes);
 expect(ordinaryPortalDelta(before,after,ns)).toBe(false);
 expect(ordinaryPortalDelta(after,before,ns)).toBe(false);
});
