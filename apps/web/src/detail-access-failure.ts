// SPDX-License-Identifier: AGPL-3.0-or-later
/** Settlement of work owned by one static detail access call only. This is not
 * authority to fall back, proof of renderer retirement, or physical GPU release. */
export class DetailAccessFailure extends Error {
 readonly retirement:'confirmed'|'uncertain';
 constructor(retirement:'confirmed'|'uncertain',cause:unknown){super(cause instanceof Error?cause.message:'STATIC_DETAIL_FAILURE',{cause});this.name='DetailAccessFailure';this.retirement=retirement;}
}
