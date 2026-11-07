// SPDX-License-Identifier: AGPL-3.0-or-later
/** A requested viewing stop is urgent, but does not cancel an active load. */
export function viewingRequestPriority(viewingPinned:boolean,current:boolean,prepareOnly:boolean,index:number):number {
 return viewingPinned?-200:current?-100:prepareOnly?100:index;
}
