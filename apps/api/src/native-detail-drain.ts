// SPDX-License-Identifier: AGPL-3.0-or-later
/** A child or stream may remain alive; rejection is not evidence of cleanup. */
export class NativeDetailDrainUncertain extends Error {
 constructor(){super('JPEG_INSPECTION_DRAIN_UNCERTAIN');this.name='NativeDetailDrainUncertain';}
}
