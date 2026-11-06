// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {prepareWorkspaceOexTerminalProof} from './workspace-oex-terminal-proof.ts';

type Scope=Parameters<typeof prepareWorkspaceOexTerminalProof>[0];
/** Candidate DB writer only. Caller must hold the owner/maintenance fences,
 * actually drain all worker/decoder children, complete the job and save its
 * exact result and native provenance in THIS dedicated transaction, roll back
 * on any error, and expose proof only after confirmed durable COMMIT. Replay
 * and Manager receipt/ACK are separate and currently not connected. */
export async function storeWorkspaceOexTerminalProof(c:PoolClient,s:Session,scope:Scope,result:unknown){
 if(!s||!['admin','artist'].includes(s.role)||s.tenantId!==scope?.tenantId||s.userId!==scope?.principalId)throw Error('OEX_TERMINAL_PROOF');
 const {proof,proofBytes,resultBytes}=prepareWorkspaceOexTerminalProof(scope,result);
 const probe=randomUUID();await c.query("SELECT set_config('exhibitos.workspace_terminal_probe',$1,true)",[probe]);
 const tx=(await c.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('exhibitos.workspace_terminal_probe',true) AS probe")).rows[0];if(tx?.isolation!=='read committed'||tx.probe!==probe)throw Error('OEX_TRANSACTION_UNSUPPORTED');
 await c.query('INSERT INTO workspace_oex_import_terminal_proof(workspace_id,tenant_id,principal_id,import_job_id,attempt_id,import_request_id,source_archive_sha256,exhibition_id,immutable_revision_id,studio_etag,result_sha256,result_bytes,proof_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[proof.workspaceId,proof.tenantId,proof.principalId,proof.jobId,proof.attemptId,proof.importRequestId,proof.sourceArchiveSha256,proof.exhibitionId,proof.immutableRevisionId,proof.studioETag,proof.resultSha256,resultBytes,proofBytes]);
 return Object.freeze({resultSha256:proof.resultSha256,resultBytes:proof.resultBytes});
}
