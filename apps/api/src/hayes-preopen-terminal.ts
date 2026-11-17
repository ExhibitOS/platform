// SPDX-License-Identifier: AGPL-3.0-or-later
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { sha256, type BlobStore } from '@exhibitos/storage';
import { ApiError, type Session } from './auth.ts';
import { assertHayesOriginalContext } from './hayes-original-attempt.ts';
import type { NativeOexWorkspaceContext } from './native-oex-provenance.ts';
import { allowedRights } from './rights.ts';

const migration = '054_hayes_preopen_terminal.sql';
const migrationHash = '1adf273344e8382fa69cfa3eb76c1ba0555d91564351854a85fc1a2bc3520664';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const source = { sha256: 'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6', bytes: 8383096 };
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> =>
 !!value && typeof value === 'object' && !Array.isArray(value) &&
 Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const unconfirmed = () => new ApiError(409, 'HAYES_PREOPEN_CLAIM_UNCONFIRMED');

export type HayesTerminalSelector = { jobId: string; proofSha256: string };
type HayesTerminalChallenge = HayesTerminalSelector & {
 challenge: string;
 nativeOwnerId: string;
 runtimeGeneration: string;
 runtimeManifestSha256: string;
};

type Observation = {
 jobId: string;
 artworkId: string;
 tenantId: string;
 workspaceId: string;
 principalId: string;
 claim: {
  systemId: string;
  databaseOid: string;
  attemptId: string;
  leaseId: string;
  correlationId: string;
  generation: string;
  leaseUntil: string;
 };
};

function sorted(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(sorted);
 if (value && typeof value === 'object') {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
   .map(([key, entry]) => [key, sorted(entry)]));
 }
 return value;
}

/** A parsed frame is evidence only. The issued Native caller owns the authenticated pipe. */
export function decodeHayesTerminalProof(raw: Uint8Array, expected: HayesTerminalChallenge) {
 try {
  if (raw.byteLength < 1 || raw.byteLength > 8192) throw unconfirmed();
  const frame: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!closed(frame, ['version','kind','jobId','proofSha256','challenge','nativeOwnerId','runtimeGeneration','runtimeManifestSha256','observation']) ||
   frame.version !== 1 || frame.kind !== 'hayes-preopen-terminal-proof' ||
   !Object.entries(expected).every(([key, value]) => frame[key] === value)) throw unconfirmed();
  const canonical = Buffer.from(JSON.stringify(sorted(frame.observation)));
  if (canonical.length > 4096 || sha256(canonical) !== expected.proofSha256) throw unconfirmed();

  const value = frame.observation;
  if (!closed(value, ['kind','version','jobId','artworkId','artworkRevision','workspaceId','tenantId','principalId','claim','state','attempts','progress',
   'outputStagePresent','dispositionPresent','releasePresent','openJournalPresent','custodyAuthoritySha256','failedRecordSha256','transferSha256','savedEtag','savedRevision']) ||
   value.kind !== 'hayes-preopen-claim-observation' || value.version !== 1 || value.jobId !== expected.jobId ||
   value.artworkRevision !== 1 || value.state !== 'processing' || value.attempts !== 1 || value.progress !== 25 ||
   ![value.outputStagePresent,value.dispositionPresent,value.releasePresent,value.openJournalPresent].every(flag => flag === false) ||
   ![value.jobId,value.artworkId,value.workspaceId,value.tenantId,value.principalId].every(id => matches(id, uuid)) ||
   ![value.custodyAuthoritySha256,value.failedRecordSha256,value.transferSha256].every(digest => matches(digest, hash)) ||
   !matches(value.savedEtag, /^"studio-r[1-9][0-9]{0,9}-[a-f0-9]{64}"$/) ||
   typeof value.savedRevision !== 'number' || !Number.isSafeInteger(value.savedRevision) || value.savedRevision < 1) throw unconfirmed();
  const claim = value.claim;
  if (!closed(claim, ['systemId','databaseOid','attemptId','leaseId','correlationId','generation','leaseUntil','leaseExpired']) ||
   ![claim.attemptId,claim.leaseId,claim.correlationId,claim.generation].every(id => matches(id, uuid)) ||
   claim.generation === expected.runtimeGeneration || claim.leaseExpired !== true ||
   !matches(claim.systemId, /^[1-9][0-9]{0,19}$/) || !matches(claim.databaseOid, /^[1-9][0-9]{0,9}$/) ||
   !matches(claim.leaseUntil, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/) ||
   !Number.isFinite(Date.parse(claim.leaseUntil))) throw unconfirmed();
  return { observation: value as unknown as Observation, canonical };
 } catch {
  throw unconfirmed();
 }
}

export async function requireHayesTerminalContext(client: PoolClient, session: Session, owner: NativeOexWorkspaceContext) {
 await assertHayesOriginalContext(client, session, owner);
 const catalog = await client.query('SELECT sha256 FROM public.schema_migrations WHERE name=$1', [migration]);
 if (catalog.rowCount !== 1 || catalog.rows[0].sha256 !== migrationHash) throw new ApiError(404, 'NOT_FOUND');
}

export async function readHayesTerminal(client: PoolClient, owner: NativeOexWorkspaceContext, selection: HayesTerminalSelector) {
 const result = await client.query(
  `SELECT attempt_id,proof_canonical,proof_sha256 FROM public.hayes_preopen_terminal_bindings
   WHERE (tenant_id,workspace_id,principal_id,job_id)=($1,$2,$3,$4)
    AND convert_from(proof_canonical,'UTF8')::jsonb#>>'{claim,systemId}'=(pg_control_system()).system_identifier::text
    AND convert_from(proof_canonical,'UTF8')::jsonb#>>'{claim,databaseOid}'=(SELECT oid::text FROM pg_database WHERE datname=current_database())`,
  [owner.tenantId,owner.workspaceId,owner.principalId,selection.jobId],
 );
 if (result.rowCount === 0) return undefined;
 const row = result.rows[0];
 if (result.rowCount !== 1 || row.proof_sha256 !== selection.proofSha256 ||
     sha256(row.proof_canonical) !== selection.proofSha256) throw new ApiError(409, 'HAYES_PREOPEN_TERMINAL_CONFLICT');
 return { jobId:selection.jobId, attemptId:String(row.attempt_id), proofSha256:selection.proofSha256, outcome:'preopen-cancelled' as const };
}

/** Runs inside the authenticated live owner's fenced transaction, after its dedicated FD proof. */
export async function recordHayesTerminal(client: PoolClient, owner: NativeOexWorkspaceContext, blobs: BlobStore,
 selection: HayesTerminalSelector, proof: ReturnType<typeof decodeHayesTerminalProof>, live: () => Promise<void>) {
 const { observation, canonical } = proof;
 const { claim } = observation;
 if (observation.jobId !== selection.jobId || sha256(canonical) !== selection.proofSha256 ||
   observation.tenantId !== owner.tenantId || observation.workspaceId !== owner.workspaceId ||
   observation.principalId !== owner.principalId) throw unconfirmed();
 const existing = await readHayesTerminal(client, owner, selection);
 if (existing) return existing;
 const result = await client.query(`
  SELECT j.rights,j.object_key,w.metadata
  FROM public.import_jobs j
  JOIN public.hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id,a.lease_id,a.artwork_id,a.principal_id)
   =(j.tenant_id,j.hayes_attempt_id,j.id,j.lease_id,j.artwork_id,j.user_id)
  JOIN public.artworks w ON (w.tenant_id,w.id)=(j.tenant_id,j.artwork_id)
  WHERE (a.tenant_id,a.workspace_id,a.principal_id,a.job_id,a.artwork_id)=($1,$2,$3,$4,$5)
   AND (a.id,a.lease_id,a.correlation_id,a.runtime_generation)=($6,$7,$8,$9)
   AND j.lease_until=$10::timestamptz AND j.lease_until<=clock_timestamp()
   AND j.state='processing' AND j.attempts=1 AND j.progress=25
   AND j.asset_id IS NULL AND j.original_asset_id IS NULL AND j.hayes_disposition_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.hayes_output_stages s WHERE s.tenant_id=j.tenant_id AND (s.job_id=j.id OR s.attempt_id=a.id))
   AND NOT EXISTS (SELECT 1 FROM public.hayes_original_dispositions d WHERE d.tenant_id=j.tenant_id AND (d.job_id=j.id OR d.attempt_id=a.id))
   AND NOT EXISTS (SELECT 1 FROM public.hayes_native_releases r WHERE r.tenant_id=j.tenant_id AND (r.job_id=j.id OR r.attempt_id=a.id))
   AND a.artwork_revision=1 AND w.revision=a.artwork_revision AND w.deleted_at IS NULL
   AND w.approved_revision IS NULL AND w.approved_asset_id IS NULL
   AND (a.source_sha256,a.source_bytes)=(j.expected_hash,j.expected_bytes)
   AND (a.source_sha256,a.source_bytes)=($11,$12) AND j.mime='model/gltf-binary'
   AND j.derived IS NULL AND j.model_derivation IS NULL
   AND (pg_control_system()).system_identifier::text=$13
   AND (SELECT oid::text FROM pg_database WHERE datname=current_database())=$14
  FOR UPDATE OF j,w`,
  [owner.tenantId,owner.workspaceId,owner.principalId,selection.jobId,observation.artworkId,
   claim.attemptId,claim.leaseId,claim.correlationId,claim.generation,claim.leaseUntil,
   source.sha256,source.bytes,claim.systemId,claim.databaseOid],
 );
 if (result.rowCount !== 1) throw unconfirmed();
 const row = result.rows[0];
 if (!isDeepStrictEqual(row.rights,row.metadata?.rights) || !allowedRights(row.rights,'display') || !allowedRights(row.rights,'export') ||
   row.metadata?.displayReference?.status !== 'provisional-uncalibrated' || row.metadata?.provenance?.sourceUnits !== 'unknown' ||
   row.metadata?.provenance?.scaleApplied !== false || !blobs.getBounded) throw unconfirmed();
 const original = Buffer.from(await blobs.getBounded(row.object_key,source.bytes));
 try {
  if (original.length !== source.bytes || sha256(original) !== source.sha256) throw unconfirmed();
 } finally {
  original.fill(0);
 }
 await owner.assertDatabase(client);
 await live();
 // The insertion trigger rechecks the expired claim, physical DB and all
 // three absent-output joins while the exact job remains locked.
 await client.query(`INSERT INTO public.hayes_preopen_terminals
  (tenant_id,attempt_id,job_id,proof_canonical,proof_sha256) VALUES ($1,$2,$3,$4,$5)`,
  [owner.tenantId,claim.attemptId,selection.jobId,canonical,selection.proofSha256]);
 const cancelled = await client.query(`UPDATE public.import_jobs SET state='cancelled',updated_at=now()
  WHERE tenant_id=$1 AND id=$2 AND hayes_attempt_id=$3 AND state='processing'`,
  [owner.tenantId,selection.jobId,claim.attemptId]);
 if (cancelled.rowCount !== 1) throw unconfirmed();
 await owner.assertDatabase(client);
 await live();
 const receipt = await readHayesTerminal(client,owner,selection);
 if (!receipt) throw unconfirmed();
 return receipt;
}
