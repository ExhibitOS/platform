// SPDX-License-Identifier: AGPL-3.0-or-later
import type {AffinePoint} from './artifact-affine.js';
import type {TrackSpotAimBinding} from './track-spot-aim-binding.js';
import type {WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';

const sourceSha256 = '06de01d214a67e68d021b164e64a1f7f621faf78bcf2d859151b56b8d6a4adf3';
const sourceBytes = 28_472;
const receiverY = -.5878568291664124;
const fitBounds = {min: [-.055, -.587857, -.042], max: [.055, 0, .042]};
const epsilon = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= epsilon;

/** The qualified CC0 source has a closed top face at y=0 and a continuous
 * 110 × 50 mm downward receiver. Its support mesh lies between these faces.
 * The original-first fit receipt alone proves only measured mesh bounds.
 * This case neither grants certified contact to another source nor changes
 * admission for unrelated ordinary rails. */
export function fixedCeilingSupportContact(
  descriptor: WorkspaceFurnishingDescriptor,
  mount: TrackSpotAimBinding['mount'],
  ceilingGap: number,
  corners: readonly AffinePoint[],
): boolean | undefined {
  if (descriptor.model.sha256 !== sourceSha256) return undefined;

  const [x, y, z] = mount.position;
  const {model, fit} = descriptor;
  const geometry = fit?.geometry;
  return descriptor.kind === 'ceiling-rail' &&
    model.mime === 'model/gltf-binary' && model.bytes === sourceBytes &&
    fit?.version === 1 && fit.sourceSha256 === sourceSha256 && fit.sourceBytes === sourceBytes &&
    geometry?.profile === 'passive-ceiling-rail-v1' &&
    geometry.min.every((value, axis) => value === fitBounds.min[axis]) &&
    geometry.max.every((value, axis) => value === fitBounds.max[axis]) &&
    ceilingGap === 0 && near(x, 0) && near(y, receiverY) && near(z, 0) && near(mount.yaw, 0) &&
    corners.length === 4 && corners.every(([u, v, w]) =>
      near(v, receiverY) && Math.abs(u) <= .054999999701976776 + epsilon &&
      Math.abs(w) <= .02500000037252903 + epsilon);
}
