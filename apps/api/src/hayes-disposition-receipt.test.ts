// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {matchHayesDispositionReceipt,parseHayesDispositionReceipt} from './hayes-disposition-receipt.ts';

it('matches the cross-language synthetic committed receipt vector without granting authority',async()=>{
 const bytes=await readFile(new URL('./test-fixtures/hayes-committed-receipt.synthetic.json',import.meta.url));
 expect(bytes.length).toBe(2625);
 expect(parseHayesDispositionReceipt(bytes).sha256).toBe('b82cc56fa47bd877538be87d276d970c8d00ea0d0bd7ddc0e7a8809afa86d64c');
 const value=JSON.parse(bytes.toString());
 const expected={receiptId:value.receiptId,binding:value.binding,nativeOwnerId:value.nativeOwnerId,runtimeManifestSha256:value.runtimeManifestSha256,workerManifestSha256:value.workerManifestSha256,nativeEvidenceSha256:value.nativeEvidenceSha256,attestation:value.attestation,dbStageId:value.dbStageId,originalAssetId:value.originalAssetId,displayAssetId:value.displayAssetId,derivativeId:value.derivativeId,database:value.database,output:{sha256:value.attestation.output.sha256,bytes:value.attestation.output.bytes},receiptSha256:'b82cc56fa47bd877538be87d276d970c8d00ea0d0bd7ddc0e7a8809afa86d64c'};
 expect(matchHayesDispositionReceipt(bytes,expected).sha256).toBe(expected.receiptSha256);
 expect(()=>matchHayesDispositionReceipt(bytes,{...expected,binding:{...expected.binding,leaseId:expected.receiptId}})).toThrow('HAYES_RECEIPT_MISMATCH');
 expect(()=>matchHayesDispositionReceipt(bytes,{...expected,database:{...expected.database,databaseOid:'1'}})).toThrow('HAYES_RECEIPT_MISMATCH');
 expect(()=>matchHayesDispositionReceipt(bytes,{...expected,output:{...expected.output,bytes:1}})).toThrow('HAYES_RECEIPT_MISMATCH');
 const reject=(candidate:unknown)=>expect(()=>parseHayesDispositionReceipt(Buffer.from(JSON.stringify(candidate)))).toThrow('HAYES_RECEIPT_INVALID');
 reject({...value,extra:true});reject({...value,outcome:'discarded'});reject({...value,displayAssetId:value.originalAssetId});
 reject({...value,attestation:{...value.attestation,source:{...value.attestation.source,bytes:1}}});
 reject({...value,attestation:{...value.attestation,workers:[...value.attestation.workers].reverse()}});
 reject({...value,database:{...value.database,databaseOid:'042'}});
 expect(()=>parseHayesDispositionReceipt(Buffer.concat([bytes,Buffer.from('\n')]))).toThrow('HAYES_RECEIPT_INVALID');
 expect(()=>parseHayesDispositionReceipt(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]))).toThrow('HAYES_RECEIPT_INVALID');
 expect(()=>parseHayesDispositionReceipt(Buffer.from([0xff]))).toThrow('HAYES_RECEIPT_INVALID');
});
