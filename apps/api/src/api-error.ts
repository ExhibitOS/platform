// SPDX-License-Identifier: AGPL-3.0-or-later
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
