// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
type Transform=Exhibition['placements'][number]['transform'];
/** Fixed GLB front is −Z; artwork front is +Z. Both are rigid unit-scale. */
export function artworkFrameMatrix(three:typeof Three,placement:Transform,artwork:Transform,imagePlaneZ=-.012){
 const matrix=(t:Transform)=>new three.Matrix4().compose(new three.Vector3(...t.position),new three.Quaternion(...t.rotation),new three.Vector3(...t.scale));
 return matrix(placement).multiply(matrix(artwork)).multiply(new three.Matrix4().makeTranslation(0,0,imagePlaneZ)).multiply(new three.Matrix4().makeRotationY(Math.PI));
}
