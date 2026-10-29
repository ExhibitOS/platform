// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not a deployment or runtime acceptance claim.
const freeze = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const DEMO_ARTWORK_PLAN = freeze({
  "version": 1,
  "base": {
    "exhibitionId": "d8de0e96-b1d0-4fe3-9cca-f9d337a014d9",
    "revisionSha256": "2a35f5f7a1ce25e569c18a90f2338d0ccbf1fda9d689d403bbd5581935582d47",
    "rooms": [
      {
        "role": "entry",
        "id": "d85f05ed-854d-47e4-a4ee-41402b92c421",
        "dimensions": {
          "depth": 4,
          "width": 4,
          "height": 4
        },
        "transform": {
          "scale": [
            1,
            1,
            1
          ],
          "position": [
            0,
            0,
            0
          ],
          "rotation": [
            0,
            0,
            0,
            1
          ]
        }
      },
      {
        "role": "painting",
        "id": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
        "dimensions": {
          "depth": 10,
          "width": 8,
          "height": 4
        },
        "transform": {
          "scale": [
            1,
            1,
            1
          ],
          "position": [
            0,
            0,
            -7
          ],
          "rotation": [
            0,
            0,
            0,
            1
          ]
        }
      },
      {
        "role": "transition",
        "id": "15cab235-38b7-43b2-9a82-936a4c17861a",
        "dimensions": {
          "depth": 10,
          "width": 4,
          "height": 4
        },
        "transform": {
          "scale": [
            1,
            1,
            1
          ],
          "position": [
            6,
            0,
            -7
          ],
          "rotation": [
            0,
            0,
            0,
            1
          ]
        }
      },
      {
        "role": "sculpture",
        "id": "1e38a515-8a39-4e7a-bd0e-3dcaf998a9fd",
        "dimensions": {
          "depth": 10,
          "width": 10,
          "height": 4
        },
        "transform": {
          "scale": [
            1,
            1,
            1
          ],
          "position": [
            13,
            0,
            -7
          ],
          "rotation": [
            0,
            0,
            0,
            1
          ]
        }
      },
      {
        "role": "closing",
        "id": "9e867fab-aa88-4243-be41-662d6f39d8bf",
        "dimensions": {
          "depth": 4,
          "width": 11,
          "height": 4
        },
        "transform": {
          "scale": [
            1,
            1,
            1
          ],
          "position": [
            7.5,
            0,
            0
          ],
          "rotation": [
            0,
            0,
            0,
            1
          ]
        }
      }
    ],
    "doorPairs": [
      {
        "a": "89f65bb8-f7e5-4d84-b540-b120f0c8a9a9",
        "b": "63b44c16-64f9-4fe3-820d-abf16de69e7e"
      },
      {
        "a": "0d8e8e3b-3dbd-4ae2-9765-265cc67406ad",
        "b": "93e6069c-c83b-4e0f-948f-b1c1eb865766"
      },
      {
        "a": "422c1411-7586-48be-97d7-92267c206331",
        "b": "e0e68848-ee2e-44bf-858a-9c96cdef645f"
      },
      {
        "a": "5f173295-6e51-4481-8e3b-90a6114b82fa",
        "b": "b8708be1-0fce-4d42-be68-0d065cca2fd1"
      },
      {
        "a": "1272fdb7-200f-43c0-8408-c53406281b23",
        "b": "37080ea9-ad56-4acd-8d7d-bb948cfe8060"
      }
    ]
  },
  "targets": {
    "paintings": 14,
    "sculptures": 5
  },
  "entries": [
    {
      "planId": "0ef144fe-1d08-41f4-9183-9024af12899e",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "e96f59b7-e162-4d66-ad8c-050d47cfca8d",
      "artworkRevisionId": "ca58c871-7855-44a6-91bb-3a3a8385ed1a",
      "artworkType": "painting",
      "title": "Wheat Field with Cypresses",
      "artist": "Vincent van Gogh",
      "description": "밀밭과 하늘을 이루는 붓질의 방향을 따라가 보세요.",
      "asset": {
        "sha256": "2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f",
        "bytes": 7503560,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.934,
        "height": 0.732
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          -2.2,
          1.5,
          -4.94
        ],
        "rotation": [
          0,
          0,
          0,
          1
        ]
      }
    },
    {
      "planId": "2691f956-b732-405a-9003-ee40c681e7bf",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "cde8ff48-ad87-433a-ad29-fd3d998fd009",
      "artworkRevisionId": "3154dacc-e27f-406c-b064-dbbee22eb380",
      "artworkType": "painting",
      "title": "Aristotle with a Bust of Homer",
      "artist": "Rembrandt (Rembrandt van Rijn)",
      "description": "밝게 드러난 손과 소매, 흉상을 차례로 살펴보세요.",
      "asset": {
        "sha256": "ca8e86fdb6e87880fc00d3db5fe89a1edef385183f2c6a64686d0f62ec6fcc57",
        "bytes": 6702081,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 1.365,
        "height": 1.435
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          0,
          1.5,
          -4.94
        ],
        "rotation": [
          0,
          0,
          0,
          1
        ]
      }
    },
    {
      "planId": "e784ad37-87c6-433a-b43c-b36f23ca9219",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "b1ba2a89-3650-45e6-af6e-5b56af57b1df",
      "artworkRevisionId": "f7400a2b-11f0-4755-843a-5c9e368c817d",
      "artworkType": "painting",
      "title": "Still Life with Apples and Pears",
      "artist": "Paul Cézanne",
      "description": "과일의 윤곽과 과일 사이의 빈 공간을 번갈아 보세요.",
      "asset": {
        "sha256": "1b58a2eb9065a3b9e35f22ee061e71594cf335fd3791909032b8387f8ef567d4",
        "bytes": 7948187,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.5870000000000001,
        "height": 0.44799999999999995
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          2.2,
          1.5,
          -4.94
        ],
        "rotation": [
          0,
          0,
          0,
          1
        ]
      }
    },
    {
      "planId": "41c538dc-d639-49cb-adba-cbfda10f84f0",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "32daa55e-2e88-4859-b1e1-5e9ace4b1534",
      "artworkRevisionId": "941714c1-b939-4559-82d1-91ca177080c0",
      "artworkType": "sculpture",
      "title": "Old Arrow Maker",
      "artist": "Edmonia Lewis",
      "description": "대리석 작품을 디지털로 기록한 3D 모델입니다.",
      "asset": {
        "sha256": "13e430d0eb72d5e2a4ef0717e5f69d56ed3d0b76b0ee0e8d987d4e3d283f3bbe",
        "bytes": 1415084,
        "mime": "model/gltf-binary"
      },
      "dimensions": {
        "depth": 0.34526312351226807,
        "width": 0.34847164154052734,
        "height": 0.54190900750109
      },
      "roomId": "1e38a515-8a39-4e7a-bd0e-3dcaf998a9fd",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          0,
          1.1709545037505449,
          0
        ],
        "rotation": [
          0,
          0,
          0,
          1
        ]
      }
    },
    {
      "planId": "796b59e0-2a0a-49b4-9f1b-cbc3eea37d06",
      "sourceKey": "met-437881",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437881",
      "artworkId": "b2f1a7b6-d60d-4e6b-8b96-a21caf4b1ee4",
      "artworkRevisionId": "69f3bf7b-d596-49ea-9546-c136904dd095",
      "artworkType": "painting",
      "title": "Young Woman with a Water Pitcher",
      "artist": "Johannes Vermeer",
      "description": "창가의 여성이 물주전자를 들고 서 있다.",
      "asset": {
        "sha256": "34ca97b51530d5ad1cc52b7abea3293309effea671c4061787e65f57f674fd76",
        "bytes": 6409438,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.40634619140625,
        "height": 0.457
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          -3.94,
          1.5,
          0
        ],
        "rotation": [
          0,
          0.7071067811865476,
          0,
          0.7071067811865476
        ]
      }
    },
    {
      "planId": "799ebaba-3aeb-4471-9687-e9171522b66c",
      "sourceKey": "met-10158",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/10158",
      "artworkId": "46db1ed8-6024-44df-bd49-8b9a7a65bbaa",
      "artworkRevisionId": "7e0ceef4-6eeb-4a4c-aeb0-29235de54588",
      "artworkType": "painting",
      "title": "Sunrise on the Matterhorn",
      "artist": "Albert Bierstadt",
      "description": "붉은빛을 받은 산봉우리가 구름 위로 솟아 있다.",
      "asset": {
        "sha256": "14fa92c56a1404aeaa0d6b218a9393956c268d907ed3ffb5c614d95b740c8174",
        "bytes": 5289955,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 1.086927734375,
        "height": 1.486
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          -2.5,
          1.5,
          4.91
        ],
        "rotation": [
          0,
          1,
          0,
          0
        ]
      }
    },
    {
      "planId": "556d2784-ce4d-4a7c-8517-2014521f70a1",
      "sourceKey": "met-436140",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436140",
      "artworkId": "c3b94e20-0030-4207-bd94-272f7c296b9e",
      "artworkRevisionId": "35dadbcd-e6f5-47aa-a3a3-031f114407c5",
      "artworkType": "painting",
      "title": "Dancers, Pink and Green",
      "artist": "Edgar Degas",
      "description": "초록빛 치마를 입은 무용수들이 각기 몸과 의상을 고쳐 잡고 있다.",
      "asset": {
        "sha256": "5ffc02ddfb46b60f8d6bb03f274fba8225607f9b2933e6dad43241f642a68398",
        "bytes": 8307464,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.7462894736842104,
        "height": 0.822
      },
      "roomId": "b60f2828-b4a2-4991-a5c9-24eb90f3cf86",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          3.94,
          1.5,
          2.5
        ],
        "rotation": [
          0,
          -0.7071067811865476,
          0,
          0.7071067811865476
        ]
      }
    }
  ],
  "unresolved": [
    {
      "roomRole": "painting",
      "artworkType": "painting",
      "count": 3,
      "reason": "Admitted artwork packets and fit decisions are pending."
    },
    {
      "roomRole": "transition",
      "artworkType": "painting",
      "count": 3,
      "reason": "Admitted artwork packets and fit decisions are pending."
    },
    {
      "roomRole": "closing",
      "artworkType": "painting",
      "count": 2,
      "reason": "Admitted artwork packets and fit decisions are pending."
    },
    {
      "roomRole": "transition",
      "artworkType": "sculpture",
      "count": 1,
      "reason": "Admitted sculpture and clear-path fit are pending."
    },
    {
      "roomRole": "sculpture",
      "artworkType": "sculpture",
      "count": 3,
      "reason": "Admitted sculptures and orbit-clearance fit are pending."
    }
  ]
});
