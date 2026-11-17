// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import { decodeHayesTerminalProof } from './hayes-preopen-terminal.ts';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const observation={
 artworkId:id(8),artworkRevision:1,attempts:1,
 claim:{attemptId:id(5),correlationId:id(7),databaseOid:'456',generation:id(6),leaseExpired:true,
  leaseId:id(4),leaseUntil:'2026-11-17T12:12:36.461+01:00',systemId:'123'},
 custodyAuthoritySha256:'a'.repeat(64),dispositionPresent:false,failedRecordSha256:'b'.repeat(64),
 jobId:id(9),kind:'hayes-preopen-claim-observation',openJournalPresent:false,outputStagePresent:false,
 principalId:id(3),progress:25,releasePresent:false,savedEtag:`"studio-r99-${'c'.repeat(64)}"`,
 savedRevision:298,state:'processing',tenantId:id(1),transferSha256:'d'.repeat(64),version:1,workspaceId:id(2),
};
const digest=(value:object)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected={
 jobId:observation.jobId,proofSha256:digest(observation),challenge:id(10),
 nativeOwnerId:id(11),runtimeGeneration:id(12),runtimeManifestSha256:'e'.repeat(64),
};
function frame(value=observation,overrides:Record<string,unknown>={}){
 return Buffer.from(JSON.stringify({version:1,kind:'hayes-preopen-terminal-proof',...expected,observation:value,...overrides}));
}

it('uses the same compact sorted bytes as Native serde_json Value',()=>{
 const proof=decodeHayesTerminalProof(frame(),expected);
 expect(proof.canonical.toString('utf8')).toBe(JSON.stringify(observation));
 expect(proof.observation.workspaceId).toBe(observation.workspaceId);
});

it.each(['challenge','nativeOwnerId','runtimeGeneration','runtimeManifestSha256','proofSha256','jobId'] as const)(
 'rejects a response with a different %s',(key)=>{
  expect(()=>decodeHayesTerminalProof(frame(observation,{[key]:id(13)}),expected)).toThrow('HAYES_PREOPEN_CLAIM_UNCONFIRMED');
 });

it.each(['outputStagePresent','dispositionPresent','releasePresent','openJournalPresent'] as const)(
 'rejects %s even if the caller selected that fingerprint',(key)=>{
  const value={...observation,[key]:true};
  const selection={...expected,proofSha256:digest(value)};
  expect(()=>decodeHayesTerminalProof(frame(value,selection),selection)).toThrow('HAYES_PREOPEN_CLAIM_UNCONFIRMED');
 });

it('rejects an unexpired lease or a claim from the current generation',()=>{
 for(const claim of [{...observation.claim,leaseExpired:false},{...observation.claim,generation:expected.runtimeGeneration}]){
  const value={...observation,claim};
  const selection={...expected,proofSha256:digest(value)};
  expect(()=>decodeHayesTerminalProof(frame(value,selection),selection)).toThrow('HAYES_PREOPEN_CLAIM_UNCONFIRMED');
 }
});
