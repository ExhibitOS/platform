// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Draft} from './studio.ts';
import {ordinaryPortalDelta} from './workspace-portal-delta.ts';
const ns='org.exhibitos.studio/workspace-furnishings';
const base=()=>({id:'draft',editVersion:1,updatedAt:'a',candidate:{title:'retained',extensions:{other:{value:1},[ns]:{version:5,furnishings:[{id:'frame',kind:'artwork-frame'}],placements:[],frameAttachments:[{placementId:'image',furnishingId:'frame'}]}}}}) as unknown as Draft;
const add=(draft:Draft)=>{const d=structuredClone(draft),ext=d.candidate.extensions![ns] as unknown as {version:number;furnishings:unknown[];openingAttachments:unknown[]};ext.version=6;ext.furnishings.push({id:'portal',kind:'portal-finish'});ext.openingAttachments=[{openingId:'door',furnishingId:'portal'}];d.editVersion++;d.updatedAt='b';return d;};
it('accepts one current-profile attach and final detach without other changes',()=>{const a=base(),b=add(a);expect(ordinaryPortalDelta(a,b,ns)).toBe(true);expect(ordinaryPortalDelta(b,a,ns)).toBe(true);expect(ordinaryPortalDelta(a,a,ns)).toBe(false);});
it('rejects unrelated changes, multiple attachments and unqualified older versions',()=>{const a=base(),b=add(a);b.candidate.title='changed';expect(ordinaryPortalDelta(a,b,ns)).toBe(false);const c=add(a),ext=c.candidate.extensions![ns] as unknown as {openingAttachments:unknown[]};ext.openingAttachments.push({openingId:'other',furnishingId:'portal'});expect(ordinaryPortalDelta(a,c,ns)).toBe(false);const old=base();(old.candidate.extensions![ns] as unknown as {version:number}).version=3;expect(ordinaryPortalDelta(old,add(old),ns)).toBe(false);});
