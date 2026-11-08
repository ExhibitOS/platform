// SPDX-License-Identifier: AGPL-3.0-or-later
import {decodeHayesReadyFrame} from './hayes-ready-frame.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/;
/** Serialization only: sending requires a live issued scope and a known
 * committed matching reservation. This function grants neither. */
export function hayesReservationFrame(rawReady:Uint8Array,expected:{binding:unknown;nativeOwnerId:string;runtimeManifestSha256:string;database:unknown},dbStageId:string):Uint8Array{
 if(typeof dbStageId!=='string'||!uuid.test(dbStageId))throw Error('HAYES_RESERVATION_FRAME_INVALID');
 const ready=decodeHayesReadyFrame(rawReady,expected),a=ready.attestation as {source:{stageId:string};output:{stageId:string;bytes:number;sha256:string}};
 if(dbStageId===a.source.stageId||dbStageId===a.output.stageId)throw Error('HAYES_RESERVATION_FRAME_INVALID');
 const output={stageId:a.output.stageId,bytes:a.output.bytes,sha256:a.output.sha256};
 const frame=Buffer.from(JSON.stringify({version:1,kind:'hayes-output-reservation-ready',binding:ready.binding,nativeEvidenceSha256:ready.nativeEvidenceSha256,dbStageId,output}));
 if(frame.length<1||frame.length>8192)throw Error('HAYES_RESERVATION_FRAME_INVALID');return frame;
}
