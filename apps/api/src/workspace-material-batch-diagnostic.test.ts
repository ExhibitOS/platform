// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {materialBatchDiagnostic,materialBatchFailureCategory} from './workspace-material-batch-diagnostic.ts';
const publication='11111111-1111-4111-8111-111111111111',material='22222222-2222-4222-8222-222222222222';
it('retains begin and first terminal with safe request-scoped phase and material only',()=>{
 const lines:string[]=[],d=materialBatchDiagnostic(true,publication,line=>lines.push(line));
 d.phase('policy',material);d.failure(Object.assign(Error('SECRET password token URL body'),{code:'55P03',headers:{authorization:'SECRET'}}),false);d.end('complete');d.failure(Error('again'),false);
 const records=lines.map(s=>JSON.parse(s.slice('WORKSPACE_MATERIAL_BATCH '.length)));
 expect(records).toHaveLength(2);expect(records[0]).toMatchObject({event:'begin',phase:'prepare',publicationId:publication});
 expect(records[1]).toMatchObject({event:'terminal',phase:'policy',category:'lock-unavailable',materialId:material});expect(records[0].requestId).toBe(records[1].requestId);
 expect(Number.isFinite(Date.parse(records[0].at))).toBe(true);expect(records[1].elapsedMs).toBeGreaterThanOrEqual(0);
 expect(lines.join('')).not.toMatch(/SECRET|password|authorization|headers|URL|body/);
 expect(Object.keys(records[1]).sort()).toEqual(['event','requestId','at','elapsedMs','phase','publicationId','materialId','category'].sort());
});
it.each([
 [{name:'TimeoutError'},'prepare',false,'timeout'],[{code:'57014'},'policy',false,'query-cancelled'],
 [{name:'AbortError'},'write',false,'abort'],[{},'policy',true,'abort'],[{},'policy',false,'policy'],
 [{},'fence',false,'fence'],[{},'header',false,'transport'],[{},'write',false,'transport'],[{},'prepare',false,'internal'],
] as const)('classifies only a fixed terminal category', (error,phase,aborted,expected)=>{
 expect(materialBatchFailureCategory(error,phase,aborted)).toBe(expected);
});
it('does not log outside native scope, unvalidated IDs or arbitrary exception messages',()=>{
 const sink=vi.fn(),disabled=materialBatchDiagnostic(false,publication,sink);disabled.failure(Error('secret'),false);expect(sink).not.toHaveBeenCalled();
 const lines:string[]=[],d=materialBatchDiagnostic(true,'https://secret.invalid/?token=secret',s=>lines.push(s));d.phase('write','secret');d.failure(Error('secret'),false);
 expect(lines.join('')).not.toMatch(/secret|publicationId|materialId/);
});
it('cannot fail a product request when the existing log sink fails',()=>{
 expect(()=>{const d=materialBatchDiagnostic(true,publication,()=>{throw Error('disk');});d.phase('write',material);d.end('transport');}).not.toThrow();
});
