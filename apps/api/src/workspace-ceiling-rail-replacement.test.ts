// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {fixtureURL,readOex,validateLifecycle} from '@exhibitos/spec';
import {WORKSPACE_FURNISHING_NAMESPACE as N,validateWorkspaceFurnishings,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {PoolClient} from 'pg';
import {newDraft} from '../../web/src/drafts/example.ts';
import {ApiError,type Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
import {ordinaryCeilingRailReplacementDelta} from './workspace-ceiling-rail-replacement-delta.ts';
const ws=(d:ReturnType<typeof newDraft>)=>d.candidate.extensions![N] as unknown as WorkspaceFurnishings;
async function setup(bounded=false,shared=false){
 const draft=newDraft();draft.candidate=JSON.parse(await readFile(new URL('./fixtures/rail-v11/exhibition.json',import.meta.resolve('@exhibitos/spec')),'utf8')) as Exhibition;draft.exhibitionId=draft.candidate.id;
 const left=ws(draft),first=left.placements[0]!,attachment=left.ceilingAttachments![0]!,old=left.furnishings[0]!;
 for(const x of [-2,2]){const id=crypto.randomUUID();left.placements.push({...structuredClone(first),id,position:[x,4,0]});left.ceilingAttachments!.push({...structuredClone(attachment),placementId:id,anchor:[x,0]});}
 if(shared){const room=structuredClone(draft.candidate.rooms[0]!);room.id=crypto.randomUUID();room.transform.position=[20,0,0];draft.candidate.rooms.push(room);const ceiling=structuredClone(draft.candidate.surfaces.find(s=>s.id===attachment.surfaceId)!);ceiling.id=crypto.randomUUID();ceiling.roomId=room.id;draft.candidate.surfaces.push(ceiling);const id=crypto.randomUUID();left.placements.push({...structuredClone(first),id,roomId:room.id});left.ceilingAttachments!.push({...structuredClone(attachment),placementId:id,surfaceId:ceiling.id});}
 if(bounded){const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),image=source.exhibition.artworks.find(a=>a.artworkType==='image')!;(draft.candidate.artworks as typeof image[]).push(...Array.from({length:10},(_,i)=>{const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;return a;}));}
 const target={...structuredClone(old),id:crypto.randomUUID(),name:'Synthetic grouped rail',model:{...old.model,sha256:'b'.repeat(64)}};target.fit={...old.fit!,sourceSha256:target.model.sha256,geometry:{profile:'passive-ceiling-rail-v1',min:[-3,-.035,-2],max:[3,0,2]}};
 const next=structuredClone(draft),right=ws(next),selected=new Set(left.placements.slice(0,3).map(p=>p.id)),id=crypto.randomUUID();right.placements=right.placements.filter(p=>!selected.has(p.id));right.ceilingAttachments=right.ceilingAttachments!.filter(a=>!selected.has(a.placementId));right.furnishings=shared?[structuredClone(old),target]:[target];right.placements.push({...structuredClone(first),id,furnishingId:target.id});right.ceilingAttachments.push({...structuredClone(attachment),placementId:id});next.editVersion++;
 const session={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session;
 const owner={workspaceId:crypto.randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:vi.fn(async()=>{})};
 const service={hasWriterLease:vi.fn(()=>true),supportsCeilingRail:vi.fn(()=>true),supportsReusableFit:vi.fn(()=>true),supportsPortalFinish:vi.fn(()=>false),authorize:vi.fn(async()=>{}),readVersion:vi.fn(async(_c:unknown,_s:unknown,id:string)=>structuredClone(id===old.id?old:target)),checkDisplay:vi.fn(async()=>structuredClone(target))};
 const studio=new Studio(owner as never,true,undefined,service as never),row={id:draft.exhibitionId,revision:2,metadata:draft,nativeBounded:bounded,studio_owner_user_id:session.userId};vi.spyOn(studio,'access').mockResolvedValue(row as never);
 const query=vi.fn(async(sql:string)=>{void sql;return {rows:[],rowCount:0};}),client={query} as unknown as PoolClient;
 return {draft,next,old,target,service,owner,studio,session,client,query,row,match:etag(2,draft),input:{draft:next,requestId:crypto.randomUUID()}};
}
it.each([false,true])('replaces only selected rails and retains shared old-source use=%s',async shared=>{
 const f=await setup(false,shared);expect(validateWorkspaceFurnishings(f.draft.candidate).valid).toBe(true);expect(validateWorkspaceFurnishings(f.next.candidate).valid).toBe(true);expect(ordinaryCeilingRailReplacementDelta(f.draft,f.next)).toBe(true);
 if(shared){expect(ws(f.next).furnishings[0]).toEqual(f.old);expect(ws(f.next).placements[0]).toEqual(ws(f.draft).placements[3]);}
 for(const edit of [(d:typeof f.next)=>{d.candidate.title+='other';},(d:typeof f.next)=>{d.candidate.lights[0]!.intensity++;},(d:typeof f.next)=>{ws(d).placements.at(-1)!.yaw=.1;},(d:typeof f.next)=>{d.candidate.extensions!['org.example/unrelated']={value:true};},(d:typeof f.next)=>{ws(d).ceilingAttachments![ws(d).ceilingAttachments!.length-1]!.gap=.2;},(d:typeof f.next)=>{ws(d).furnishings.at(-1)!.fit!.sourceSha256='c'.repeat(64);}]){const bad=structuredClone(f.next);edit(bad);expect(ordinaryCeilingRailReplacementDelta(f.draft,bad)).toBe(false);}
});
it.each([false,true])('preflights and saves registered rail replacement under ordinary/bounded=%s current CAS',async bounded=>{
 const f=await setup(bounded);expect(validateLifecycle(f.draft).valid).toBe(!bounded);
 expect(await f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,f.input,f.match)).toMatchObject({valid:true});expect(f.query).not.toHaveBeenCalled();
 expect(await f.studio.put(f.client,f.session,f.draft.exhibitionId,f.input,f.match)).toMatchObject({revision:3,draft:f.next});expect(f.service.checkDisplay).toHaveBeenCalledTimes(2);
 expect(f.query.mock.calls.filter(c=>String(c[0]).startsWith('UPDATE exhibitions'))).toHaveLength(1);
});
it('rejects stale, unsupported, unrelated and unauthorized replacements before writes',async()=>{
 const f=await setup(true),preflight=(draft=f.next,match=f.match)=>f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,{...f.input,draft},match),put=()=>f.studio.put(f.client,f.session,f.draft.exhibitionId,f.input,f.match);
 await expect(preflight(f.next,etag(1,f.draft))).rejects.toMatchObject({code:'REMOTE_CONFLICT'});expect(f.service.checkDisplay).not.toHaveBeenCalled();
 const unrelated=structuredClone(f.next);unrelated.candidate.title+='other';await expect(preflight(unrelated)).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});
 f.service.hasWriterLease.mockReturnValue(false);await expect(preflight()).rejects.toMatchObject({code:'FORBIDDEN'});await expect(put()).rejects.toMatchObject({code:'BOUNDED_EDIT_UNSUPPORTED'});f.service.hasWriterLease.mockReturnValue(true);
 f.service.supportsCeilingRail.mockReturnValue(false);await expect(preflight()).rejects.toMatchObject({code:'FORBIDDEN'});f.service.supportsCeilingRail.mockReturnValue(true);
 f.service.checkDisplay.mockRejectedValueOnce(new ApiError(409,'ASSET_INTEGRITY'));await expect(preflight()).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
 f.service.authorize.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));await expect(put()).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(f.query.mock.calls.filter(c=>/^(UPDATE|INSERT|DELETE)/.test(String(c[0])))).toHaveLength(0);
});

it('rejects cross-room removal and preserves exact source ordering, descriptors and other records',async()=>{
 const f=await setup(false,true),bad=structuredClone(f.next),right=ws(bad);right.placements.shift();right.ceilingAttachments!.shift();right.furnishings.shift();
 expect(validateWorkspaceFurnishings(bad.candidate).valid).toBe(true);expect(ordinaryCeilingRailReplacementDelta(f.draft,bad)).toBe(false);
 const changedSurvivor=structuredClone(f.next);ws(changedSurvivor).placements[0]!.position[0]=1;ws(changedSurvivor).ceilingAttachments![0]!.anchor[0]=1;expect(validateWorkspaceFurnishings(changedSurvivor.candidate).valid).toBe(true);expect(ordinaryCeilingRailReplacementDelta(f.draft,changedSurvivor)).toBe(false);
});
it('checks replay authority once per source, current ETag and live registry rather than trusting scene metadata',async()=>{
 const f=await setup(true),replay={draft:structuredClone(f.draft),requestId:crypto.randomUUID()};
 expect(await f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,replay,f.match)).toMatchObject({valid:true});expect(f.service.checkDisplay).toHaveBeenCalledTimes(1);
 f.owner.tenantId=crypto.randomUUID();await expect(f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,f.input,f.match)).rejects.toMatchObject({code:'FORBIDDEN'});f.owner.tenantId=f.session.tenantId;
 f.service.readVersion.mockResolvedValueOnce({...f.target,name:'forged registry disagreement'});await expect(f.studio.validateNativeViewport(f.client,f.session,f.draft.exhibitionId,f.input,f.match)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});expect(f.query).not.toHaveBeenCalled();
});
