// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {uuid} from './auth.ts';
import {etag,type Draft} from './studio.ts';

const LIMIT=4*1024*1024,PROOF_LIMIT=8192,hex=/^[a-f0-9]{64}$/,studioEtag=/^"studio-r1-[a-f0-9]{64}"$/;
type Scope={workspaceId:string;tenantId:string;principalId:string;jobId:string;attemptId:string;importRequestId:string;sourceArchiveSha256:string};
/** Prepare deterministic durable terminal bytes, not a completion authority.
 * The owning caller must hold all fences, prove actual worker/decoder drain,
 * atomically persist these EXACT bytes and their proof alongside the completed
 * result, and publish only after a confirmed commit. Replay must be bound to
 * the same durable principal/workspace/job/attempt; transient tokens and ACKs
 * must never erase or replace the stored bytes. Not connected to any route. */
export function prepareWorkspaceOexTerminalProof(scope:Scope,result:unknown){
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).sort().join(',')!=='attemptId,importRequestId,jobId,principalId,sourceArchiveSha256,tenantId,workspaceId')throw Error('OEX_TERMINAL_PROOF');
 const snapshot=structuredClone(scope);for(const id of [snapshot.workspaceId,snapshot.tenantId,snapshot.principalId,snapshot.jobId,snapshot.attemptId,snapshot.importRequestId]){try{uuid(id);}catch{throw Error('OEX_TERMINAL_PROOF');}if(id!==id.toLowerCase())throw Error('OEX_TERMINAL_PROOF');}
 if(typeof snapshot.sourceArchiveSha256!=='string'||!hex.test(snapshot.sourceArchiveSha256))throw Error('OEX_TERMINAL_PROOF');
 let canonical:string;try{canonical=freezeCanonical(result);}catch{throw Error('OEX_TERMINAL_PROOF');}const bytes=Buffer.from(canonical,'utf8');if(bytes.length<1||bytes.length>LIMIT)throw Error('OEX_TERMINAL_PROOF');
 let value:unknown;try{value=JSON.parse(canonical);}catch{throw Error('OEX_TERMINAL_PROOF');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_TERMINAL_PROOF');const v=value as {revision?:unknown;etag?:unknown;exhibitionId?:unknown;draft?:unknown;idMap?:unknown;assetAliases?:unknown};
 if(v.revision!==1||typeof v.etag!=='string'||!studioEtag.test(v.etag)||typeof v.exhibitionId!=='string'||!v.draft||typeof v.draft!=='object'||Array.isArray(v.draft)||!v.idMap||typeof v.idMap!=='object'||Array.isArray(v.idMap)||!Array.isArray(v.assetAliases))throw Error('OEX_TERMINAL_PROOF');
 const draft=v.draft as {exhibitionId?:unknown;candidate?:unknown};if(!draft.candidate||typeof draft.candidate!=='object'||Array.isArray(draft.candidate))throw Error('OEX_TERMINAL_PROOF');const candidate=draft.candidate as {id?:unknown;revisionId?:unknown};
 if(typeof candidate.id!=='string'||typeof candidate.revisionId!=='string'||draft.exhibitionId!==v.exhibitionId||candidate.id!==v.exhibitionId||v.etag!==etag(1,v.draft as Draft))throw Error('OEX_TERMINAL_PROOF');
 for(const id of [v.exhibitionId,candidate.revisionId]){try{uuid(id);}catch{throw Error('OEX_TERMINAL_PROOF');}if(id!==id.toLowerCase())throw Error('OEX_TERMINAL_PROOF');}
 const proof={version:1 as const,kind:'workspace-oex-import-terminal' as const,workspaceId:snapshot.workspaceId,tenantId:snapshot.tenantId,principalId:snapshot.principalId,jobId:snapshot.jobId,attemptId:snapshot.attemptId,importRequestId:snapshot.importRequestId,sourceArchiveSha256:snapshot.sourceArchiveSha256,archiveFormat:'1.0.0-draft.12' as const,exhibitionId:v.exhibitionId,immutableRevisionId:candidate.revisionId,studioETag:v.etag,resultBytes:bytes.length,resultSha256:createHash('sha256').update(bytes).digest('hex')};
 const proofBytes=Buffer.from(JSON.stringify(proof),'utf8');if(proofBytes.length>PROOF_LIMIT)throw Error('OEX_TERMINAL_PROOF');
 return {proof:Object.freeze(proof),proofBytes,resultBytes:bytes};
}
