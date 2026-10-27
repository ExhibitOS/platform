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
  },
  {
    "id": "cylindrical-plinth",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/cylindrical-plinth/model.glb",
    "bytes": 60340,
    "sha256": "1dfcaad91f9b4c2370c157e101df6cc136eb44a108959aab3deb74851b45f392",
    "triangles": 1536,
    "bounds": {
      "min": [
        -0.32499998807907104,
        0,
        -0.32499998807907104
      ],
      "max": [
        0.32499998807907104,
        0.8500000238418579,
        0.32499998807907104
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/cylindrical-plinth/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "1dfcaad91f9b4c2370c157e101df6cc136eb44a108959aab3deb74851b45f392",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "plinth",
      "supportPlaneY": 0.8500000238418579,
      "coplanarUpwardTriangles": 128,
      "actualFlatBounds": {
        "min": [
          -0.3230000138282776,
          0.8500000238418579,
          -0.3230000138282776
        ],
        "max": [
          0.3230000138282776,
          0.8500000238418579,
          0.3230000138282776
        ]
      },
      "verifiedInset": {
        "shape": "disk",
        "radius": 0.322
      }
    }
  },
  {
    "id": "low-wide-plinth",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/low-wide-plinth/model.glb",
    "bytes": 39568,
    "sha256": "e9cc627463599a73d5364ab6bd005b44d64e30d0c458df0c4c026a7e70859947",
    "triangles": 376,
    "bounds": {
      "min": [
        -0.8999999761581421,
        0,
        -0.6000000238418579
      ],
      "max": [
        0.8999999761581421,
        0.17999999970197678,
        0.6000000238418579
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/low-wide-plinth/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "e9cc627463599a73d5364ab6bd005b44d64e30d0c458df0c4c026a7e70859947",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "plinth",
      "supportPlaneY": 0.17999999970197678,
      "coplanarUpwardTriangles": 2,
      "actualFlatBounds": {
        "min": [
          -0.8980000019073486,
          0.17999999970197678,
          -0.5980000495910645
        ],
        "max": [
          0.8980000019073486,
          0.17999999970197678,
          0.5980000495910645
        ]
      },
      "verifiedInset": {
        "shape": "rectangle",
        "width": 1.796,
        "depth": 1.196
      }
    }
  },
  {
    "id": "upholstered-gallery-bench",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/upholstered-gallery-bench/model.glb",
    "bytes": 203064,
    "sha256": "6924041a37702eb8233bf39da973f2235ff951f4b1f31ab564d4ad125542b3de",
    "triangles": 2092,
    "bounds": {
      "min": [
        -0.75,
        0,
        -0.23999999463558197
      ],
      "max": [
        0.75,
        0.4599999934434891,
        0.23999999463558197
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/upholstered-gallery-bench/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "6924041a37702eb8233bf39da973f2235ff951f4b1f31ab564d4ad125542b3de",
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
      "seatEnvelopeY": 0.46,
      "seats": [
        {
          "point": [
            -0.38,
            0.46,
            0
          ],
          "designation": "authored-virtual-seat",
          "directSurfaceContactVerified": true,
          "measuredVerticalContactY": 0.4599999934434891
        },
        {
          "point": [
            0.38,
            0.46,
            0
          ],
          "designation": "authored-virtual-seat",
          "directSurfaceContactVerified": true,
          "measuredVerticalContactY": 0.4599999934434891
        }
      ]
    }
  },
  {
    "id": "gallery-stool",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/gallery-stool/model.glb",
    "bytes": 415848,
    "sha256": "6caca94361b540fb007c6fc605e519e436462eda43f2ec5f99da6a63108bfc60",
    "triangles": 5736,
    "bounds": {
      "min": [
        -0.1899999976158142,
        0,
        -0.1899999976158142
      ],
      "max": [
        0.1899999976158142,
        0.44999998807907104,
        0.1899999976158142
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/gallery-stool/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "6caca94361b540fb007c6fc605e519e436462eda43f2ec5f99da6a63108bfc60",
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
            0,
            0.45,
            0
          ],
          "designation": "authored-virtual-seat",
          "directSurfaceContactVerified": true,
          "measuredVerticalContactY": 0.44999998807907104
        }
      ]
    }
  },
  {
    "id": "double-width-portal",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/double-width-portal/model.glb",
    "bytes": 164044,
    "sha256": "385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b",
    "triangles": 1692,
    "bounds": {
      "min": [
        -1.2400000281631947,
        0,
        -0.10600000014528632
      ],
      "max": [
        1.2400000281631947,
        2.639999885112047,
        0.10600000014528632
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/double-width-portal/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b",
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
        "width": 2.4,
        "height": 2.6,
        "depth": 0.2
      },
      "interiorTriangleIntersections": 0,
      "parts": [
        {
          "name": "Face_trim",
          "bounds": {
            "min": [
              -1.2400000281631947,
              0,
              0.10000000009313226
            ],
            "max": [
              -1.2000000290572643,
              2.5999999046325684,
              0.10600000014528632
            ]
          }
        },
        {
          "name": "Face_trim.001",
          "bounds": {
            "min": [
              1.2000000290572643,
              0,
              0.10000000009313226
            ],
            "max": [
              1.2400000281631947,
              2.5999999046325684,
              0.10600000014528632
            ]
          }
        },
        {
          "name": "Face_trim.002",
          "bounds": {
            "min": [
              -1.2400000281631947,
              0,
              -0.10600000014528632
            ],
            "max": [
              -1.2000000290572643,
              2.5999999046325684,
              -0.10000000009313226
            ]
          }
        },
        {
          "name": "Face_trim.003",
          "bounds": {
            "min": [
              1.2000000290572643,
              0,
              -0.10600000014528632
            ],
            "max": [
              1.2400000281631947,
              2.5999999046325684,
              -0.10000000009313226
            ]
          }
        },
        {
          "name": "Head",
          "bounds": {
            "min": [
              -1.225000023841858,
              2.5999999521300197,
              -0.10000000149011612
            ],
            "max": [
              1.225000023841858,
              2.6249999525025487,
              0.10000000149011612
            ]
          }
        },
        {
          "name": "Head_trim",
          "bounds": {
            "min": [
              -1.2400000095367432,
              2.599999886006117,
              0.10000000009313226
            ],
            "max": [
              1.2400000095367432,
              2.639999885112047,
              0.10600000014528632
            ]
          }
        },
        {
          "name": "Head_trim.001",
          "bounds": {
            "min": [
              -1.2400000095367432,
              2.599999886006117,
              -0.10600000014528632
            ],
            "max": [
              1.2400000095367432,
              2.639999885112047,
              -0.10000000009313226
            ]
          }
        },
        {
          "name": "Jamb",
          "bounds": {
            "min": [
              -1.2249999763444066,
              0,
              -0.10000000149011612
            ],
            "max": [
              -1.1999999759718776,
              2.5999999046325684,
              0.10000000149011612
            ]
          }
        },
        {
          "name": "Jamb.001",
          "bounds": {
            "min": [
              1.1999999759718776,
              0,
              -0.10000000149011612
            ],
            "max": [
              1.2249999763444066,
              2.5999999046325684,
              0.10000000149011612
            ]
          }
        }
      ],
      "collision": "unverified-preserve-opening"
    }
  },
  {
    "id": "straight-gallery-partition",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/straight-gallery-partition/model.glb",
    "bytes": 57512,
    "sha256": "c040bf79e0faa4cf7f316c689cd74ddc7e3aeede321c4e7d949406c5d9758470",
    "triangles": 564,
    "bounds": {
      "min": [
        -1.2000000476837158,
        0,
        -0.20999999344348907
      ],
      "max": [
        1.2000000476837158,
        2.4000000953674316,
        0.20999999344348907
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/straight-gallery-partition/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "c040bf79e0faa4cf7f316c689cd74ddc7e3aeede321c4e7d949406c5d9758470",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "partition",
      "planes": [
        {
          "point": [
            0,
            1.2,
            -0.05999999865889555
          ],
          "normal": [
            0,
            0,
            -1
          ]
        }
      ],
      "collision": "unverified-preserve-shape"
    }
  },
  {
    "id": "corner-gallery-partition",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/corner-gallery-partition/model.glb",
    "bytes": 57052,
    "sha256": "244ca85cd1403062674a0caa3e9c03267eaf81257594581f936896f81b6c541a",
    "triangles": 564,
    "bounds": {
      "min": [
        -0.11999999731779099,
        0,
        -1.2000000476837158
      ],
      "max": [
        2,
        2.4000000953674316,
        0.11999999731779099
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/corner-gallery-partition/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "244ca85cd1403062674a0caa3e9c03267eaf81257594581f936896f81b6c541a",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "partition",
      "planes": [
        {
          "point": [
            1,
            1,
            0
          ],
          "normal": [
            0,
            0,
            -1
          ]
        },
        {
          "point": [
            0,
            1,
            -0.6
          ],
          "normal": [
            1,
            0,
            0
          ]
        }
      ],
      "collision": "unverified-preserve-shape"
    }
  },
  {
    "id": "minimal-barrier",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/minimal-barrier/model.glb",
    "bytes": 161844,
    "sha256": "6794ce62cae8ab7e7b4432bc6f4c0c98a9a867a2f8174508337c85a7b43c3327",
    "triangles": 1580,
    "bounds": {
      "min": [
        -0.6000000238418579,
        0,
        -0.07999999821186066
      ],
      "max": [
        0.6000000238418579,
        0.2999999914318323,
        0.07999999821186066
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/minimal-barrier/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "6794ce62cae8ab7e7b4432bc6f4c0c98a9a867a2f8174508337c85a7b43c3327",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "barrier",
      "crossbarTopY": 0.2999999914318323,
      "collision": "unverified"
    }
  },
  {
    "id": "linear-track",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/linear-track/model.glb",
    "bytes": 187688,
    "sha256": "1ba64842de525166018e941074852a3e041d07adf605674c7d7fadb02693a09e",
    "triangles": 1880,
    "bounds": {
      "min": [
        -0.5000000129221007,
        -0.03500000014901161,
        -0.017500000074505806
      ],
      "max": [
        0.5000000129221007,
        0,
        0.017500000074505806
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/linear-track/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "1ba64842de525166018e941074852a3e041d07adf605674c7d7fadb02693a09e",
      "recipe": "original-v1"
    }
  },
  {
    "id": "recessed-downlight",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/recessed-downlight/model.glb",
    "bytes": 86480,
    "sha256": "041c6c2c340a039f1eb82f70d925c1ecbe913276deaba5b447e540d67fc2e7bf",
    "triangles": 1920,
    "bounds": {
      "min": [
        -0.05999999865889549,
        -0.00800000037997961,
        -0.05999999865889549
      ],
      "max": [
        0.05999999865889549,
        0.06700000166893005,
        0.05999999865889549
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/recessed-downlight/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "041c6c2c340a039f1eb82f70d925c1ecbe913276deaba5b447e540d67fc2e7bf",
      "recipe": "original-v1"
    },
    "functional": {
      "evidence": "authored-reference-and-actual-glb",
      "consumerBehavior": "unverified",
      "kind": "light",
      "apertureCentre": [
        0,
        -0.008,
        0
      ],
      "apertureDesignation": "authored-reference",
      "aim": [
        0,
        -1,
        0
      ],
      "opaqueLensContact": [
        0,
        0.03500000014901161,
        0
      ]
    }
  },
  {
    "id": "tall-display-vitrine",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/tall-display-vitrine/model.glb",
    "bytes": 248188,
    "sha256": "c191b4d18cc0a7a6942b1bd67e3e9658de3df41c7a2a56ccd88a84c814494e2c",
    "triangles": 2444,
    "bounds": {
      "min": [
        -0.32500000577419996,
        0,
        -0.33100000908598304
      ],
      "max": [
        0.32500000577419996,
        1.7999999662861228,
        0.32500000577419996
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/tall-display-vitrine/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "c191b4d18cc0a7a6942b1bd67e3e9658de3df41c7a2a56ccd88a84c814494e2c",
      "recipe": "original-v1"
    }
  },
  {
    "id": "tabletop-display-case",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/tabletop-display-case/model.glb",
    "bytes": 210616,
    "sha256": "4bee8dd06fea65990a08b3cb4633d8c81cdaa7d6c3f575f5748adec8538a19a6",
    "triangles": 2068,
    "bounds": {
      "min": [
        -0.6000000261701643,
        0,
        -0.3249999904073775
      ],
      "max": [
        0.6000000261701643,
        1.0000000023283064,
        0.3249999904073775
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/tabletop-display-case/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "4bee8dd06fea65990a08b3cb4633d8c81cdaa7d6c3f575f5748adec8538a19a6",
      "recipe": "original-v1"
    }
  },
  {
    "id": "freestanding-info-stand",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/freestanding-info-stand/model.glb",
    "bytes": 112044,
    "sha256": "4e26824b897af85e781c102cf7f01e404e4266b4d5299088c2b29940facaccba",
    "triangles": 1072,
    "bounds": {
      "min": [
        -0.20999999344348907,
        0,
        -0.1599999964237213
      ],
      "max": [
        0.20999999344348907,
        1.0493346696257329,
        0.1599999964237213
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/freestanding-info-stand/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "4e26824b897af85e781c102cf7f01e404e4266b4d5299088c2b29940facaccba",
      "recipe": "original-v1"
    }
  },
  {
    "id": "wall-title-panel",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/wall-title-panel/model.glb",
    "bytes": 93416,
    "sha256": "6295491bb93c90921bffabdf1d16f0697491c3be014e8ad8c2a7130a7de66c3e",
    "triangles": 940,
    "bounds": {
      "min": [
        -0.44999998807907104,
        -0.30000001192092896,
        -0.022000000812113285
      ],
      "max": [
        0.44999998807907104,
        0.30000001192092896,
        0
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/wall-title-panel/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "6295491bb93c90921bffabdf1d16f0697491c3be014e8ad8c2a7130a7de66c3e",
      "recipe": "original-v1"
    }
  },
  {
    "id": "gallery-frame",
    "version": 1,
    "mime": "model/gltf-binary",
    "path": "assets/furnishings/user-authored-20261027/gallery-frame/model.glb",
    "bytes": 78732,
    "sha256": "50b1caa7c100150f9872236e5866dec072ea2fa86747ce38e1cd3204aa6c5072",
    "triangles": 752,
    "bounds": {
      "min": [
        -0.32499998807907104,
        -0.42500001192092896,
        -0.03500000014901161
      ],
      "max": [
        0.32499998807907104,
        0.42500001192092896,
        0
      ]
    },
    "rights": {
      "licenseId": "CC0-1.0",
      "noticePath": "assets/furnishings/user-authored-20261027/gallery-frame/LICENSE-NOTICE.txt"
    },
    "provenance": {
      "sourceSha256": "50b1caa7c100150f9872236e5866dec072ea2fa86747ce38e1cd3204aa6c5072",
      "recipe": "original-v1"
    }
  }
] as const satisfies readonly UserAssetCatalogueEntry[];
