// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {detailSourceCommitment,newDetailSourceNonce} from './detail-source-commitment.ts';
it('matches the fixed canonical source commitment vector',()=>{expect(detailSourceCommitment({version:1,artworkRevisionId:'00000000-0000-4000-8000-000000000001',candidateId:'00000000-0000-4000-8000-000000000002',assetId:'00000000-0000-4000-8000-000000000003',tier:'acquired-original',sha256:'a'.repeat(64),bytes:100,mime:'image/jpeg',featureReportSha256:'b'.repeat(64),rightsEvidenceSha256:'c'.repeat(64),nonce:'d'.repeat(32)})).toBe('b53067dc06e1d91a1ab08bdc2855178506554661942ea7787151aeb2913f685a');});
it('keeps binding opaque and sensitive to private evidence and public identity',()=>{
 const binding={version:1 as const,artworkRevisionId:randomUUID(),candidateId:randomUUID(),assetId:randomUUID(),tier:'acquired-original' as const,sha256:'a'.repeat(64),bytes:100,mime:'image/jpeg' as const,featureReportSha256:'b'.repeat(64),rightsEvidenceSha256:'c'.repeat(64),nonce:newDetailSourceNonce()};const first=detailSourceCommitment(binding);
 expect(first).toMatch(/^[a-f0-9]{64}$/);expect(detailSourceCommitment({...binding})).toBe(first);expect(detailSourceCommitment({...binding,nonce:newDetailSourceNonce()})).not.toBe(first);expect(detailSourceCommitment({...binding,rightsEvidenceSha256:'d'.repeat(64)})).not.toBe(first);expect(detailSourceCommitment({...binding,assetId:randomUUID()})).not.toBe(first);
 expect(()=>detailSourceCommitment({...binding,nonce:'0'.repeat(30)})).toThrow('DETAIL_BINDING_INVALID');expect(()=>detailSourceCommitment({...binding,bytes:25*1024*1024+1})).toThrow('DETAIL_BINDING_INVALID');expect(()=>detailSourceCommitment({...binding,extra:'secret'} as typeof binding)).toThrow('DETAIL_BINDING_INVALID');
 const spoof=Object.assign(Object.create({artworkRevisionId:binding.artworkRevisionId,assetId:binding.assetId}),binding);delete spoof.artworkRevisionId;delete spoof.assetId;spoof['artworkRevisionId,assetId']='fake';expect(()=>detailSourceCommitment(spoof)).toThrow('DETAIL_BINDING_INVALID');
 const getter={...binding};Object.defineProperty(getter,'nonce',{enumerable:true,get:()=>binding.nonce});expect(()=>detailSourceCommitment(getter)).toThrow('DETAIL_BINDING_INVALID');
});
