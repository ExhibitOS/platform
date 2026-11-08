// SPDX-License-Identifier: AGPL-3.0-or-later
import type {BlobStore} from '@exhibitos/storage';
import type {HayesOperationBinding} from './hayes-operation-binding.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

export type HayesReadyScope=Readonly<{
 binding:HayesOperationBinding;signal:AbortSignal;deadlineMs:number;phase:'ready'|'reserved'|'copied';
 nativeOwnerId:string;runtimeManifestSha256:string;workerManifestSha256:string;nativeEvidenceSha256:string;
 attestation:Readonly<Record<string,unknown>>;dbStageId:string;
 database:Readonly<{systemIdentifier:string;databaseOid:string}>;assertLive:()=>Promise<void>;
}>;
/** There is deliberately no issuer yet. The future implementation must look
 * up an opaque one-shot identity in a private WeakMap populated only by the
 * authenticated ready/positive-adapter receive state. Its scope must be
 * bound to these exact issued owner and blob-store objects and go invalid on
 * channel closure. No parsed JSON or public boolean may create that scope. */
export function resolveHayesReady(_admission:unknown,_owner:NativeOexWorkspaceContext,_blobs:BlobStore):HayesReadyScope{
 throw Error('HAYES_READY_NOT_ADMITTED');
}
