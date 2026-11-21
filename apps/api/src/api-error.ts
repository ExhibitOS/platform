// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DoorPairEditError} from '@exhibitos/studio-contract';
export class ApiError extends Error { readonly status:number; readonly code:string; constructor(status:number,code:string) {super(code);this.status=status;this.code=code;} }

/** Safe detail for the owner-scoped articulated aiming proposal only. */
export class NativeTrackSpotAimProposalError extends ApiError {
 constructor(reason:string,remedy:string){
  super(422,'AUTHORING_PROPOSAL_INVALID');
  this.message=`${reason}: ${remedy}`;
 }
}

/** A reference already checked against the current authenticated workspace. */
export class WorkspaceFurnishingReferenceError extends ApiError {
 constructor(status:number,code:string,id:string,version:number,reason:string){
  super(status,code);
  this.message=`Furnishing ${id} (version ${version}): ${reason}`;
 }
}

/** Stable geometry detail from a resolved opening on the authenticated draft. */
export class NativeDoorPairEditProposalError extends ApiError {
 readonly doorPairViolation;
 constructor({constraint,openingId,roomId}:DoorPairEditError){
  super(422,'DOOR_PAIR_EDIT_INVALID');
  this.doorPairViolation={constraint,...(openingId&&{openingId}),...(roomId&&{roomId})};
 }
}
