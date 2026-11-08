// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {decodeHayesReadyFrame} from './hayes-ready-frame.ts';
it('checks canonical ready data and independent pins without issuing authority',async()=>{
 const vector=JSON.parse(await readFile(new URL('./test-fixtures/hayes-committed-receipt.synthetic.json',import.meta.url),'utf8'));
 const attestation={...vector.attestation,containment:{...vector.attestation.containment,kind:'darwin-fixed-hayes-leaves-v1'}};
 const ready={version:1,kind:'hayes-output-ready',binding:vector.binding,nativeOwnerId:vector.nativeOwnerId,runtimeManifestSha256:vector.runtimeManifestSha256,workerManifestSha256:vector.workerManifestSha256,nativeEvidenceSha256:vector.nativeEvidenceSha256,attestation,database:vector.database},expected={binding:vector.binding,nativeOwnerId:vector.nativeOwnerId,runtimeManifestSha256:vector.runtimeManifestSha256,workerManifestSha256:vector.workerManifestSha256,database:vector.database},encode=(v:unknown)=>Buffer.from(JSON.stringify(v));
 expect(decodeHayesReadyFrame(encode(ready),expected)).toEqual(ready);
 expect(()=>decodeHayesReadyFrame(encode({...ready,extra:true}),expected)).toThrow('HAYES_READY_FRAME_INVALID');
 expect(()=>decodeHayesReadyFrame(encode({...ready,attestation:{...attestation,containment:{...attestation.containment,kind:'test-only'}}}),expected)).toThrow('HAYES_READY_FRAME_INVALID');
 expect(()=>decodeHayesReadyFrame(encode({...ready,attestation:{...attestation,output:{...attestation.output,bytes:1}}}),expected)).toThrow('HAYES_READY_FRAME_INVALID');
 expect(()=>decodeHayesReadyFrame(encode({...ready,attestation:{...attestation,output:{...attestation.output,stageId:attestation.source.stageId}}}),expected)).toThrow('HAYES_READY_FRAME_INVALID');
 expect(()=>decodeHayesReadyFrame(encode(ready),{...expected,database:{...expected.database,databaseOid:'1'}})).toThrow('HAYES_READY_FRAME_INVALID');
 expect(()=>decodeHayesReadyFrame(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),encode(ready)]),expected)).toThrow('HAYES_READY_FRAME_INVALID');
});
