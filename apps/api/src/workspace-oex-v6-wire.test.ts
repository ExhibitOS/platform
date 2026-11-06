// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {parseOexPreflightReportV3} from './oex-preflight-report-v3.ts';
import {parsePackedOexControlV2} from './oex-packed-control-v2.ts';

it('correlates the exact synthetic v6 preflight and packed-control bytes',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../test-fixtures/workspace-oex-v6-owner-wire-v1.json',import.meta.url),'utf8')) as {frames:Record<string,{utf8:string;sha256:string}>};
 for(const frame of Object.values(fixture.frames))expect(createHash('sha256').update(frame.utf8).digest('hex')).toBe(frame.sha256);
 const selection=JSON.parse(fixture.frames.uploadSelection!.utf8),control=JSON.parse(fixture.frames.preflightControl!.utf8),frame=JSON.parse(fixture.frames.packedControl!.utf8),packed=frame.control;
 const reportExpected={correlationId:selection.correlationId,attemptId:control.attemptId,runtimeGeneration:control.runtimeGeneration,stageId:control.stageId,reservationId:control.reservationId,reservationGeneration:control.reservationGeneration,reservationDigest:control.reservationDigest,archiveBytes:control.archiveBytes,archiveSha256:control.archiveSha256,inputDevice:control.inputDevice,inputInode:control.inputInode,archiveFormat:'1.0.0-draft.12' as const};
 const report=Buffer.from(fixture.frames.preflightReport!.utf8);expect(parseOexPreflightReportV3(report,reportExpected,true).evidence.packedBytes).toBe(128);expect(()=>parseOexPreflightReportV3(report,reportExpected)).toThrow();
 const expected={correlationId:frame.correlationId,tenantId:packed.tenantId,resourceId:packed.resourceId,jobId:packed.jobId,userId:packed.userId,requestId:packed.requestId,leaseId:packed.leaseId,attemptId:packed.attemptId,runtimeGeneration:packed.runtimeGeneration,stageId:packed.stageId,reservationId:packed.reservationId,reservationGeneration:packed.reservationGeneration,archiveBytes:packed.archiveBytes,archiveSha256:packed.archiveSha256,capacity:packed.capacity,inputDevice:packed.inputDevice,inputInode:packed.inputInode,outputDevice:packed.outputDevice,reservationDigest:packed.reservationDigest,sourceDigest:packed.sourceDigest,workerDigest:packed.workerDigest,archiveFormat:'1.0.0-draft.12' as const};
 const raw=Buffer.from(fixture.frames.packedControl!.utf8);expect(parsePackedOexControlV2(raw,expected,'v3',true).controlSha256).toBe(createHash('sha256').update(JSON.stringify(packed)).digest('hex'));expect(()=>parsePackedOexControlV2(raw,expected,'v3')).toThrow();
});
