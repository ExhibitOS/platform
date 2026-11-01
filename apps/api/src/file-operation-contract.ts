// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';

/** Internal, inactive contract; durable ownership, process drain and recovery
 * must be supplied by a qualified runtime before any product route uses it.
 * Component receipts must also bind the full user/request/lease/stage and
 * reservation identities; these shared keys alone do not provide authority. */
export interface FileOperationIdentity {
 operation:'publication'|'oex-import'|'oex-export'|'oex-freeze';
 tenantId:string;
 /** Canonical shared resource identity, agreed across producers and recovery. */
 resourceId:string;
 attemptId:string;
 generation:string;
}
export interface FileOperationHooks<TPrepared,TResult> {
 /** Under the operation fence, persist the existing journal's exclusive
  * resource claim and its exact reservation binding before any work starts.
  * A failed or interrupted claim is never automatically released. */
 claimPersistent(identity:Readonly<FileOperationIdentity>,signal:AbortSignal):Promise<void>;
 /** Insert an active durable receipt under a short fenced transaction; reject uncertain prior attempts. */
 claim(client:PoolClient,identity:Readonly<FileOperationIdentity>):Promise<void>;
 /** Journal external writes before effects and retain reservations until drain;
  * no owner transaction or global authorization lock is held during preparation. */
 prepare(identity:Readonly<FileOperationIdentity>,signal:AbortSignal):Promise<TPrepared>;
 /** Establish actual process-tree/write drain and no respawn, independent of DB session or lease. */
 confirmDrained(identity:Readonly<FileOperationIdentity>):Promise<void>;
 /** Revalidate the same durable claim outside the global-lock transaction.
  * Its owner must forbid release while this operation fence is held. */
 verifyPersistentClaim(identity:Readonly<FileOperationIdentity>,signal:AbortSignal):Promise<void>;
 /** Verify exact active receipt, live reservation, lease, source and current authority. */
 checkFinal(client:PoolClient,identity:Readonly<FileOperationIdentity>):Promise<void>;
 /** Write only transactional DB state, including the terminal outcome and manifest references. */
 finalize(client:PoolClient,identity:Readonly<FileOperationIdentity>,prepared:TPrepared):Promise<TResult>;
 /** Recheck terminal outcome, current authority and lease immediately before COMMIT. */
 checkBeforeCommit(client:PoolClient,identity:Readonly<FileOperationIdentity>):Promise<void>;
 /** Optional trusted continuation after a known successful COMMIT while the
  * same operation fence remains held. It must await actual completion of any
  * started work even on abort/error; failure cannot undo that COMMIT. */
 afterCommit?(identity:Readonly<FileOperationIdentity>,result:TResult,signal:AbortSignal):Promise<void>;
}
/** Hooks are trusted internal component code. Final hooks must not control the
 * transaction, perform external IO or leave detached work; cancellation after
 * COMMIT is sent cannot revoke a successful commit. Unknown outcomes retain
 * receipts and reservations until independently reconciled. */
export interface FileOperationRunner {
 runOperation<TPrepared,TResult>(identity:FileOperationIdentity,hooks:FileOperationHooks<TPrepared,TResult>,signal:AbortSignal):Promise<TResult>;
}
