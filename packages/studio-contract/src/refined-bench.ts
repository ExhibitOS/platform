// SPDX-License-Identifier: AGPL-3.0-or-later
import type {UserAssetCatalogueEntry} from './user-asset-catalogue.js';
// Approved v5 original, default bundle 1.10. Geometry is measured from its
// reimport in metres and converted from Blender Z-up to glTF +Y-up (x,z,-y).
// Functional references are virtual product defaults, not physical seating proof.

// Conservative AABBs of the 13 named actual mesh components; not exact mesh
// collision, seating clearance, or engineering qualification.
export const REFINED_BENCH_COLLISION_BOXES = [
 {
  "position": [
   0.0,
   0.7285000085830688,
   -0.24901316314935684
  ],
  "dimensions": {
   "width": 1.3600000143051147,
   "height": 0.22699999809265137,
   "depth": 0.08778218924999237
  }
 },
 {
  "position": [
   -0.6806399822235107,
   0.7269999980926514,
   -0.28200000524520874
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.11000001430511475,
   "depth": 0.029999971389770508
  }
 },
 {
  "position": [
   -0.7089999914169312,
   0.004000000189989805,
   0.2070000022649765
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.00800000037997961,
   "depth": 0.07500001788139343
  }
 },
 {
  "position": [
   -0.7089999914169312,
   0.004000000189989805,
   -0.1979999989271164
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.00800000037997961,
   "depth": 0.07500001788139343
  }
 },
 {
  "position": [
   -0.6806399822235107,
   0.4000000059604645,
   0.01000000536441803
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.018000006675720215,
   "depth": 0.4000000059604645
  }
 },
 {
  "position": [
   -0.7089999914169312,
   0.4106099526397884,
   -0.032460734248161316
  ],
  "dimensions": {
   "width": 0.04999995231628418,
   "height": 0.8052199045196176,
   "depth": 0.557610958814621
  }
 },
 {
  "position": [
   0.6806399822235107,
   0.7269999980926514,
   -0.28200000524520874
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.11000001430511475,
   "depth": 0.029999971389770508
  }
 },
 {
  "position": [
   0.7089999914169312,
   0.004000000189989805,
   0.2070000022649765
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.00800000037997961,
   "depth": 0.07500001788139343
  }
 },
 {
  "position": [
   0.7089999914169312,
   0.004000000189989805,
   -0.1979999989271164
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.00800000037997961,
   "depth": 0.07500001788139343
  }
 },
 {
  "position": [
   0.6806399822235107,
   0.4000000059604645,
   0.01000000536441803
  ],
  "dimensions": {
   "width": 0.0549999475479126,
   "height": 0.018000006675720215,
   "depth": 0.4000000059604645
  }
 },
 {
  "position": [
   0.7089999914169312,
   0.4106099526397884,
   -0.032460734248161316
  ],
  "dimensions": {
   "width": 0.04999995231628418,
   "height": 0.8052199045196176,
   "depth": 0.557610958814621
  }
 },
 {
  "position": [
   0.0,
   0.4288817495107651,
   0.0
  ],
  "dimensions": {
   "width": 1.3700000047683716,
   "height": 0.041763514280319214,
   "depth": 0.47999998927116394
  }
 },
 {
  "position": [
   0.0,
   0.3630000054836273,
   -0.10499999672174454
  ],
  "dimensions": {
   "width": 1.090000033378601,
   "height": 0.0350000262260437,
   "depth": 0.0260000079870224
  }
 }
] as const;

export const REFINED_BENCH:UserAssetCatalogueEntry = Object.freeze<UserAssetCatalogueEntry>({
 id:'sculpture-bench-refined',version:1,mime:'model/gltf-binary',
 path:'assets/furnishings/exhibitos-authored-20261112/sculpture-bench-refined/model.glb',
 bytes:345608,sha256:'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9',triangles:3552,
 bounds:{min:[-.7364999651908875,0,-.3112662136554718],max:[.7364999651908875,.8420000076293945,.24634474515914917]},
 rights:{licenseId:'CC0-1.0',noticePath:'assets/furnishings/exhibitos-authored-20261112/sculpture-bench-refined/LICENSE-NOTICE.txt',noticeBytes:892,noticeSha256:'4e14161b2a63d79429a0f4861d0e8400691ad84d80f4b8974f48b1644db359b9'},
 functional:{kind:'bench',benchKind:'backed',front:[0,0,1],seatEnvelopeY:.45,
  evidence:'authored-reference-and-actual-glb',consumerBehavior:'unverified',
  // Virtual centre at the existing .45m seat envelope; no measured contact
  // is asserted at this point. Neither direct contact nor Sit is qualified.
  seats:[{point:[0,.45,0],designation:'authored-virtual-seat',directSurfaceContactVerified:false}],
  collision:{kind:'component-aabbs',qualification:'proxy-only',boxes:REFINED_BENCH_COLLISION_BOXES}},
 provenance:{sourceSha256:'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9',recipe:'original-v1'},
});

