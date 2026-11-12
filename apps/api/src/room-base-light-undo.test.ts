// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {applyLightObjectCommand,ensureRoomBaseLight,LIGHT_DETAILS_NAMESPACE,type LightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {ordinaryRoomBaseLightEdit} from './room-base-light-delta.ts';
const tenantId='bbbbbbbb-0000-4000-8000-000000000001';
function fixture(mode:'manual'|undefined){
 const original=newDraft();original.candidate=ensureRoomBaseLight(original.candidate,original.candidate.rooms[0]!.id);
 const binding=(original.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!;
 if(mode){binding.basePlacement=mode;original.candidate.lights[0]!.transform.position=[1,2,1];}else delete binding.basePlacement;
 original.candidate.lights[0]!.intensity=0;original.candidate.lights[0]!.color=[.2,.3,.4];
 const current=structuredClone(original);current.editVersion+=1;current.updatedAt='2026-11-12T01:00:00.000Z';
 const lightId=current.candidate.lights[0]!.id;
 current.candidate=applyLightObjectCommand(current.candidate,mode?{type:'remove-light-object',lightId}:{type:'set-room-base-light-placement',lightId,basePlacement:'auto'},{verifiedBaseline:current.candidate}).candidate;
 const target=structuredClone(original);target.editVersion=current.editVersion+1;target.updatedAt='2026-11-12T01:01:00.000Z';
 return {original,current,target,scope:{tenantId,exhibitionId:original.exhibitionId,revision:8}};
}
const client=(rows:unknown[])=>{const query=vi.fn().mockResolvedValue({rows,rowCount:rows.length});return {query,c:({query} as unknown as PoolClient)};};
it('restores exact stored UNKNOWN intent through reverse replay and existing scoped revision history',async()=>{
 const {original,current,target,scope}=fixture(undefined),before=structuredClone(current),after=structuredClone(target),{query,c}=client([{snapshot:original}]);
 expect(await ordinaryRoomBaseLightEdit(c,scope,current,target)).toBe(true);expect(query).toHaveBeenCalledTimes(1);
 const [sql,params]=query.mock.calls[0]!;expect(String(sql)).toContain('exhibition_revisions');expect(String(sql)).toContain('tenant_id');expect(String(sql)).toContain('exhibition_id');expect(String(sql)).toContain('revision');expect(params).toContain(scope.tenantId);expect(params).toContain(scope.exhibitionId);expect(params).toContain(scope.revision);
 expect(current).toEqual(before);expect(target).toEqual(after);expect((target.candidate.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:LightDetails[]}).lights[0]!.basePlacement).toBeUndefined();
});
it('restores the original removed manual light identity, position, off and RGB from stored history',async()=>{
 const {original,current,target,scope}=fixture('manual'),{c}=client([{snapshot:original}]);expect(await ordinaryRoomBaseLightEdit(c,scope,current,target)).toBe(true);
 expect(target.candidate.lights[0]).toEqual(original.candidate.lights[0]);expect(target.candidate.lights[0]!.intensity).toBe(0);expect(target.candidate.lights[0]!.transform.position).toEqual([1,2,1]);
});
it('never authorizes a reverse-only target without an exact stored snapshot',async()=>{
 const f=fixture(undefined);expect(await ordinaryRoomBaseLightEdit(client([]).c,f.scope,f.current,f.target)).toBe(false);
 const different=structuredClone(f.original);different.candidate.title='another snapshot';expect(await ordinaryRoomBaseLightEdit(client([{snapshot:different}]).c,f.scope,f.current,f.target)).toBe(false);
 const mixed=structuredClone(f.target);mixed.candidate.title='not part of base-light undo';const mock=client([{snapshot:mixed}]);expect(await ordinaryRoomBaseLightEdit(mock.c,f.scope,f.current,mixed)).toBe(false);expect(mock.query).not.toHaveBeenCalled();
});
it('ordinary forward replay does not scan history and unrelated historical changes do not gain permission',async()=>{
 const f=fixture(undefined),mock=client([]);expect(await ordinaryRoomBaseLightEdit(mock.c,f.scope,f.original,f.current)).toBe(true);expect(mock.query).not.toHaveBeenCalled();
 const unrelated=structuredClone(f.current);unrelated.candidate.title='historical title';const historical=client([{snapshot:unrelated}]);expect(await ordinaryRoomBaseLightEdit(historical.c,f.scope,f.current,unrelated)).toBe(false);expect(historical.query).not.toHaveBeenCalled();
});
