// SPDX-License-Identifier: AGPL-3.0-or-later
import type {HayesOperationBinding} from './hayes-operation-binding.ts';

export type HayesReadyScope=Readonly<{
 binding:HayesOperationBinding;signal:AbortSignal;deadlineMs:number;phase:'ready'|'reserved'|'copied';
 nativeOwnerId:string;runtimeManifestSha256:string;workerManifestSha256:string;nativeEvidenceSha256:string;
 attestation:Readonly<Record<string,unknown>>;dbStageId:string;
 database:Readonly<{systemIdentifier:string;databaseOid:string}>;assertLive:()=>Promise<void>;
}>;
/** Only the authenticated caller owns issuance and state transitions. */
export {resolveHayesReady} from './native-hayes-caller.ts';
