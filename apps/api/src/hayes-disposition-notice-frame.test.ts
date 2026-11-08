// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {decodeHayesDispositionChallenge,encodeHayesDispositionNotice} from './hayes-disposition-notice-frame.ts';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
const sample=JSON.parse(await readFile(new URL('./test-fixtures/hayes-ready-rust.synthetic.json',import.meta.url),'utf8'));
const expected={binding:parseHayesOperationBinding(sample.binding),nativeOwnerId:sample.nativeOwnerId as string,runtimeManifestSha256:sample.runtimeManifestSha256 as string,readyFrameSha256:'e'.repeat(64),dbStageId:'10000000-0000-4000-8000-000000000016'};
const challenge='10000000-0000-4000-8000-000000000014',receiptId='10000000-0000-4000-8000-000000000015',receiptSha256='f'.repeat(64);
const body=()=>({version:1,kind:'hayes-disposition-challenge',...expected,challenge});
it('decodes the bound challenge and encodes only a compact receipt selector',()=>{
 const decoded=decodeHayesDispositionChallenge(Buffer.from(JSON.stringify(body())),expected),notice=encodeHayesDispositionNotice(decoded,{receiptId,receiptSha256});
 expect(JSON.parse(Buffer.from(notice).toString())).toEqual({version:1,kind:'hayes-disposition-committed',...expected,challenge,receiptId,receiptSha256});expect(notice.length).toBeLessThan(8192);
});
it('rejects wrong owner, binding, malformed, noncanonical and oversized challenges',()=>{
 const values=[{...body(),nativeOwnerId:receiptId},{...body(),challenge:'wrong'},{...body(),dbStageId:receiptId},{...body(),readyFrameSha256:'0'.repeat(64)},{...body(),binding:{...expected.binding,jobId:receiptId}},{...body(),extra:true}];
 for(const v of values)expect(()=>decodeHayesDispositionChallenge(Buffer.from(JSON.stringify(v)),expected)).toThrow('HAYES_DISPOSITION_CHALLENGE_INVALID');
 const b=expected.binding,reordered={tenantId:b.tenantId,version:b.version,...Object.fromEntries(Object.entries(b).filter(([key])=>key!=='version'&&key!=='tenantId'))};
 expect(()=>decodeHayesDispositionChallenge(Buffer.from(JSON.stringify({...body(),binding:reordered})),expected)).toThrow('HAYES_DISPOSITION_CHALLENGE_INVALID');
 for(const raw of [Buffer.from(JSON.stringify(body())+' '),Buffer.from([0xff]),Buffer.alloc(8193)])expect(()=>decodeHayesDispositionChallenge(raw,expected)).toThrow('HAYES_DISPOSITION_CHALLENGE_INVALID');
});
it('rejects invalid receipt selectors',()=>{const decoded=decodeHayesDispositionChallenge(Buffer.from(JSON.stringify(body())),expected);expect(()=>encodeHayesDispositionNotice(decoded,{receiptId,receiptSha256:'invalid'})).toThrow('HAYES_DISPOSITION_NOTICE_INVALID');});
