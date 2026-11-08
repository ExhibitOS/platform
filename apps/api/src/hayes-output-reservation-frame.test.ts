// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {hayesReservationFrame} from './hayes-output-reservation-frame.ts';
it('encodes the agreed reservation shape without granting send authority',async()=>{
 const v=JSON.parse(await readFile(new URL('./test-fixtures/hayes-committed-receipt.synthetic.json',import.meta.url),'utf8')),attestation={...v.attestation,containment:{...v.attestation.containment,kind:'darwin-fixed-hayes-leaves-v1'}},ready={version:1,kind:'hayes-output-ready',binding:v.binding,nativeOwnerId:v.nativeOwnerId,runtimeManifestSha256:v.runtimeManifestSha256,workerManifestSha256:'94a6551d16af3fb134f94549d9f087ee8ccb9fd2372d914de5f738a78d3505c6',nativeEvidenceSha256:v.nativeEvidenceSha256,attestation,database:v.database},expected={binding:v.binding,nativeOwnerId:v.nativeOwnerId,runtimeManifestSha256:v.runtimeManifestSha256,database:v.database},bytes=Buffer.from(JSON.stringify(ready));
 const frame=hayesReservationFrame(bytes,expected,v.dbStageId),decoded=JSON.parse(Buffer.from(frame).toString());
 expect(Object.keys(decoded)).toEqual(['version','kind','binding','nativeEvidenceSha256','dbStageId','output']);expect(Object.keys(decoded.output)).toEqual(['stageId','bytes','sha256']);expect(decoded).toMatchObject({version:1,kind:'hayes-output-reservation-ready',binding:v.binding,nativeEvidenceSha256:v.nativeEvidenceSha256,dbStageId:v.dbStageId,output:{stageId:attestation.output.stageId,bytes:attestation.output.bytes,sha256:attestation.output.sha256}});
 expect(()=>hayesReservationFrame(bytes,expected,attestation.output.stageId)).toThrow('HAYES_RESERVATION_FRAME_INVALID');expect(()=>hayesReservationFrame(bytes,expected,'bad')).toThrow('HAYES_RESERVATION_FRAME_INVALID');
});
