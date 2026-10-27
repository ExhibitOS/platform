// SPDX-License-Identifier: AGPL-3.0-or-later
// Immutable distribution-source records, not a new OEX schema or runtime admission registry.
// Metres, GLB +Y up, authored front -Z. Retain source node transforms; no recentering.
// Asset rights are independent of this module's code license. No preview is selected.
type Point = readonly [number, number, number];
type Bounds = { readonly min: Point; readonly max: Point };
type Evidence = {
  readonly evidence: 'authored-reference-and-actual-glb' | 'actual-glb-geometry';
  readonly consumerBehavior: 'unverified';
};
type Functional = Evidence & (
  | { readonly kind: 'bench'; readonly front: Point; readonly seatEnvelopeY: number;
      readonly seats: readonly { readonly point: Point; readonly designation: 'authored-virtual-seat';
        readonly directSurfaceContactVerified: boolean; readonly measuredVerticalContactY: number }[] }
  | { readonly kind: 'light'; readonly apertureCentre: Point; readonly apertureDesignation: 'authored-reference';
      readonly aim: Point; readonly pivot?: Point; readonly pivotAxis?: Point; readonly opaqueLensContact: Point }
  | { readonly kind: 'portal'; readonly front: Point;
      readonly clearOpening: { readonly width: number; readonly height: number; readonly depth: number };
      readonly interiorTriangleIntersections: 0; readonly parts: readonly { readonly name: string; readonly bounds: Bounds }[];
      readonly collision: 'unverified-preserve-opening' }
  | { readonly kind: 'plinth'; readonly supportPlaneY: number; readonly coplanarUpwardTriangles: number;
      readonly actualFlatBounds: Bounds;
      readonly verifiedInset: { readonly shape: 'rectangle'; readonly width: number; readonly depth: number }
        | { readonly shape: 'disk'; readonly radius: number } }
  | { readonly kind: 'partition'; readonly planes: readonly { readonly point: Point; readonly normal: Point }[];
      readonly collision: 'unverified-preserve-shape' }
  | { readonly kind: 'barrier'; readonly crossbarTopY: number; readonly collision: 'unverified' }
);
export type UserAssetCatalogueEntry = {
  readonly id: string;
  readonly version: 1;
  readonly mime: 'model/gltf-binary';
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly triangles: number;
  readonly bounds: Bounds;
  readonly rights: { readonly licenseId: 'CC0-1.0'; readonly noticePath: string };
  readonly provenance: { readonly sourceSha256: string; readonly recipe: 'original-v1' };
  readonly functional?: Functional;
};

// Detailed qualification, transfer receipts and authoring originals remain outside the product.
// Consumer interaction, illumination, collision, visual quality and mobile performance remain unverified.
export const USER_ASSET_CATALOGUE = [
  {
    "id": "backless-oak-bench",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/backless-oak-bench/model.glb",
    "bytes": 205668,
    "sha256": "364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b",
    "triangles": 2068,
    "bounds": {
      "min": [
        -0.800000011920929,
        0,
        -0.22499999776482582
      ],
      "max": [
        0.800000011920929,
        0.45000001043081284,
        0.22499999776482582
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/backless-oak-bench/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "bench",
      "front": [
        0,
        0,
        -1
      ],
      "seatEnvelopeY": 0.45,
      "seats": [
        {
          "point": [
            -0.4,
            0.45,
            0
          ],
          "designation": "authored-virtual-seat",
          "directSurfaceContactVerified": false,
          "measuredVerticalContactY": 0.36000000685453415
        },
        {
          "point": [
            0.4,
            0.45,
            0
          ],
          "designation": "authored-virtual-seat",
          "directSurfaceContactVerified": false,
          "measuredVerticalContactY": 0.36000000685453415
        }
      ]
    }
  },
  {
    "id": "museum-track-spot",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/museum-track-spot/model.glb",
    "bytes": 257676,
    "sha256": "4385cd058231a400b0e1bffd1f107ca3b0c7281a41671a8858f8fa7ed3721f90",
    "triangles": 4260,
    "bounds": {
      "min": [
        -0.05999999865889549,
        -0.19249999523162842,
        -0.0754999965429306
      ],
      "max": [
        0.05999999865889549,
        0,
        0.07500000298023224
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/museum-track-spot/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "4385cd058231a400b0e1bffd1f107ca3b0c7281a41671a8858f8fa7ed3721f90",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "light",
      "apertureCentre": [
        0,
        -0.15,
        -0.0755
      ],
      "apertureDesignation": "authored-reference",
      "aim": [
        0,
        0,
        -1
      ],
      "opaqueLensContact": [
        0,
        -0.15,
        -0.028999999165534973
      ],
      "pivot": [
        0,
        -0.15,
        0
      ],
      "pivotAxis": [
        1,
        0,
        0
      ]
    }
  },
  {
    "id": "gallery-open-portal",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/gallery-open-portal/model.glb",
    "bytes": 166324,
    "sha256": "b4117f9d48416feaf52f17889208050e49e984f79d6cf89c1e1de70432b6e432",
    "triangles": 1692,
    "bounds": {
      "min": [
        -0.5899999924004078,
        0,
        -0.08100000163540244
      ],
      "max": [
        0.5899999924004078,
        2.2400000281631947,
        0.08100000163540244
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/gallery-open-portal/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "b4117f9d48416feaf52f17889208050e49e984f79d6cf89c1e1de70432b6e432",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "portal",
      "front": [
        0,
        0,
        -1
      ],
      "clearOpening": {
        "width": 1.1,
        "height": 2.2,
        "depth": 0.15
      },
      "interiorTriangleIntersections": 0,
      "parts": [
        {
          "name": "Face_trim",
          "bounds": {
            "min": [
              -0.5899999924004078,
              0,
              0.07500000158324838
            ],
            "max": [
              -0.5499999932944775,
              2.200000047683716,
              0.08100000163540244
            ]
          }
        },
        {
          "name": "Face_trim.001",
          "bounds": {
            "min": [
              0.5499999932944775,
              0,
              0.07500000158324838
            ],
            "max": [
              0.5899999924004078,
              2.200000047683716,
              0.08100000163540244
            ]
          }
        },
        {
          "name": "Face_trim.002",
          "bounds": {
            "min": [
              -0.5899999924004078,
              0,
              -0.08100000163540244
            ],
            "max": [
              -0.5499999932944775,
              2.200000047683716,
              -0.07500000158324838
            ]
          }
        },
        {
          "name": "Face_trim.003",
          "bounds": {
            "min": [
              0.5499999932944775,
              0,
              -0.08100000163540244
            ],
            "max": [
              0.5899999924004078,
              2.200000047683716,
              -0.07500000158324838
            ]
          }
        },
        {
          "name": "Head",
          "bounds": {
            "min": [
              -0.574999988079071,
              2.200000095181167,
              -0.07500000298023224
            ],
            "max": [
              0.574999988079071,
              2.225000095553696,
              0.07500000298023224
            ]
          }
        },
        {
          "name": "Head_trim",
          "bounds": {
            "min": [
              -0.5899999737739563,
              2.2000000290572643,
              0.07500000158324838
            ],
            "max": [
              0.5899999737739563,
              2.2400000281631947,
              0.08100000163540244
            ]
          }
        },
        {
          "name": "Head_trim.001",
          "bounds": {
            "min": [
              -0.5899999737739563,
              2.2000000290572643,
              -0.08100000163540244
            ],
            "max": [
              0.5899999737739563,
              2.2400000281631947,
              -0.07500000158324838
            ]
          }
        },
        {
          "name": "Jamb",
          "bounds": {
            "min": [
              -0.5750000001862645,
              0,
              -0.07500000298023224
            ],
            "max": [
              -0.5499999998137355,
              2.200000047683716,
              0.07500000298023224
            ]
          }
        },
        {
          "name": "Jamb.001",
          "bounds": {
            "min": [
              0.5499999998137355,
              0,
              -0.07500000298023224
            ],
            "max": [
              0.5750000001862645,
              2.200000047683716,
              0.07500000298023224
            ]
          }
        }
      ],
      "collision": "unverified-preserve-opening"
    }
  },
  {
    "id": "rectangular-plinth",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/rectangular-plinth/model.glb",
    "bytes": 38412,
    "sha256": "67db8564375294bf9dcd867d94fa5754c6cbcefb67c5e2a5563aed876f79c02b",
    "triangles": 376,
    "bounds": {
      "min": [
        -0.25,
        0,
        -0.25
      ],
      "max": [
        0.25,
        0.9000000059604645,
        0.25
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/rectangular-plinth/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "67db8564375294bf9dcd867d94fa5754c6cbcefb67c5e2a5563aed876f79c02b",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "plinth",
      "supportPlaneY": 0.9000000059604645,
      "coplanarUpwardTriangles": 2,
      "actualFlatBounds": {
        "min": [
          -0.2485000044107437,
          0.9000000059604645,
          -0.2485000044107437
        ],
        "max": [
          0.2485000044107437,
          0.9000000059604645,
          0.2485000044107437
        ]
      },
      "verifiedInset": {
        "shape": "rectangle",
        "width": 0.496,
        "depth": 0.496
      }
    }
  }
] as const satisfies readonly UserAssetCatalogueEntry[];
