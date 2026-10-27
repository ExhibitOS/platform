// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not an updated publication or an admission/runtime claim.
// Entries reference the current pinned public data; unresolved slots contain no fabricated assets.
export const DEMO_ARTWORK_PLAN = Object.freeze({
  "version": 1,
  "base": Object.freeze({
    "exhibitionId": "8b80c52e-09e1-4c87-8606-4eae5f8da199",
    "revisionSha256": "0e15701cb533c009b57f347f08636db6c006c4a9e93415deeaca085b6fe54d30",
    "rooms": Object.freeze([
      Object.freeze({
        "role": "entry",
        "id": "125396b6-f527-4592-8b7c-46eb6a1a6880",
        "dimensions": Object.freeze({
          "depth": 4,
          "width": 4,
          "height": 4
        }),
        "transform": Object.freeze({
          "scale": Object.freeze([
            1,
            1,
            1
          ]),
          "position": Object.freeze([
            0,
            0,
            0
          ]),
          "rotation": Object.freeze([
            0,
            0,
            0,
            1
          ])
        })
      }),
      Object.freeze({
        "role": "painting",
        "id": "390f20f2-bed0-4cf2-b8c6-0f3c92b8f916",
        "dimensions": Object.freeze({
          "depth": 10,
          "width": 8,
          "height": 4
        }),
        "transform": Object.freeze({
          "scale": Object.freeze([
            1,
            1,
            1
          ]),
          "position": Object.freeze([
            0,
            0,
            -7
          ]),
          "rotation": Object.freeze([
            0,
            0,
            0,
            1
          ])
        })
      }),
      Object.freeze({
        "role": "transition",
        "id": "312c9aef-fb2e-44ad-8801-561d6617f03d",
        "dimensions": Object.freeze({
          "depth": 10,
          "width": 4,
          "height": 4
        }),
        "transform": Object.freeze({
          "scale": Object.freeze([
            1,
            1,
            1
          ]),
          "position": Object.freeze([
            6,
            0,
            -7
          ]),
          "rotation": Object.freeze([
            0,
            0,
            0,
            1
          ])
        })
      }),
      Object.freeze({
        "role": "sculpture",
        "id": "f9b45fa2-3325-4d97-87d4-d48a491ad87e",
        "dimensions": Object.freeze({
          "depth": 10,
          "width": 10,
          "height": 4
        }),
        "transform": Object.freeze({
          "scale": Object.freeze([
            1,
            1,
            1
          ]),
          "position": Object.freeze([
            13,
            0,
            -7
          ]),
          "rotation": Object.freeze([
            0,
            0,
            0,
            1
          ])
        })
      }),
      Object.freeze({
        "role": "closing",
        "id": "82ff44eb-a3e7-4cab-984b-042ff0c282d6",
        "dimensions": Object.freeze({
          "depth": 4,
          "width": 11,
          "height": 4
        }),
        "transform": Object.freeze({
          "scale": Object.freeze([
            1,
            1,
            1
          ]),
          "position": Object.freeze([
            7.5,
            0,
            0
          ]),
          "rotation": Object.freeze([
            0,
            0,
            0,
            1
          ])
        })
      })
    ]),
    "doorPairs": Object.freeze([
      Object.freeze({
        "a": "7c36d29e-6dec-4f10-99a2-c97da198bb09",
        "b": "aca58201-ec77-4792-aa3e-07bc4f4fdf55"
      }),
      Object.freeze({
        "a": "0d79d5d2-687b-433e-9c93-d0dfe2beab1a",
        "b": "a65f7d8c-c5e2-4b9d-9d10-095cf01026ab"
      }),
      Object.freeze({
        "a": "78bb4211-0e5f-486f-8058-d9bead614eb0",
        "b": "fc5f934a-54ea-4af3-baa9-6a32530ecb26"
      }),
      Object.freeze({
        "a": "35fc642c-d99b-4425-92af-0099155be7fc",
        "b": "a6481407-eccc-4c14-a6ed-80815daa74f6"
      }),
      Object.freeze({
        "a": "62593ba4-4800-4227-83d8-17b947d7fcb8",
        "b": "5bad4a79-10b6-4f92-ab7f-a82d2fa65027"
      })
    ])
  }),
  "targets": Object.freeze({
    "paintings": 14,
    "sculptures": 5
  }),
  "entries": Object.freeze([
    Object.freeze({
      "planId": "6f160b87-d061-4c2c-bdd3-b39b272dbe50",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "c275a6b5-71a6-4b58-948f-a03aea4bb48b",
      "artworkRevisionId": "313dc2e4-a988-4b5a-9fa7-3483b928ac04",
      "artworkType": "painting",
      "title": "Wheat Field with Cypresses",
      "artist": "Vincent van Gogh",
      "description": "밀밭과 하늘을 이루는 붓질의 방향을 따라가 보세요.",
      "asset": Object.freeze({
        "sha256": "2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f",
        "bytes": 7503560,
        "mime": "image/png"
      }),
      "dimensions": Object.freeze({
        "width": 0.934,
        "height": 0.732
      }),
      "roomId": "390f20f2-bed0-4cf2-b8c6-0f3c92b8f916",
      "placement": Object.freeze({
        "scale": Object.freeze([
          1,
          1,
          1
        ]),
        "position": Object.freeze([
          -2.2,
          1.5,
          -4.94
        ]),
        "rotation": Object.freeze([
          0,
          0,
          0,
          1
        ])
      })
    }),
    Object.freeze({
      "planId": "f0eb01d4-b11b-48b6-9977-ebcebce5e222",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "63f3ac85-9df6-4759-ae9b-f9fab210c560",
      "artworkRevisionId": "9f5e7bb6-401d-4707-96c0-4a5853db67bb",
      "artworkType": "painting",
      "title": "Aristotle with a Bust of Homer",
      "artist": "Rembrandt (Rembrandt van Rijn)",
      "description": "밝게 드러난 손과 소매, 흉상을 차례로 살펴보세요.",
      "asset": Object.freeze({
        "sha256": "ca8e86fdb6e87880fc00d3db5fe89a1edef385183f2c6a64686d0f62ec6fcc57",
        "bytes": 6702081,
        "mime": "image/png"
      }),
      "dimensions": Object.freeze({
        "width": 1.365,
        "height": 1.435
      }),
      "roomId": "390f20f2-bed0-4cf2-b8c6-0f3c92b8f916",
      "placement": Object.freeze({
        "scale": Object.freeze([
          1,
          1,
          1
        ]),
        "position": Object.freeze([
          0,
          1.5,
          -4.94
        ]),
        "rotation": Object.freeze([
          0,
          0,
          0,
          1
        ])
      })
    }),
    Object.freeze({
      "planId": "f715b982-507e-4daa-a20d-5adba9e737af",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "58572d85-46e3-4d94-9c0b-8ec433e4ff14",
      "artworkRevisionId": "415f94f5-fc95-40c6-9b56-7a36696f5efb",
      "artworkType": "painting",
      "title": "Still Life with Apples and Pears",
      "artist": "Paul Cézanne",
      "description": "과일의 윤곽과 과일 사이의 빈 공간을 번갈아 보세요.",
      "asset": Object.freeze({
        "sha256": "1b58a2eb9065a3b9e35f22ee061e71594cf335fd3791909032b8387f8ef567d4",
        "bytes": 7948187,
        "mime": "image/png"
      }),
      "dimensions": Object.freeze({
        "width": 0.5870000000000001,
        "height": 0.44799999999999995
      }),
      "roomId": "390f20f2-bed0-4cf2-b8c6-0f3c92b8f916",
      "placement": Object.freeze({
        "scale": Object.freeze([
          1,
          1,
          1
        ]),
        "position": Object.freeze([
          2.2,
          1.5,
          -4.94
        ]),
        "rotation": Object.freeze([
          0,
          0,
          0,
          1
        ])
      })
    }),
    Object.freeze({
      "planId": "ead08efb-ec27-49ab-af0e-292401c7d9b4",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "1cb212b8-6e34-4c18-a78c-855ad5c7efab",
      "artworkRevisionId": "f7884673-a2ea-4905-80dd-9cf502297a6b",
      "artworkType": "sculpture",
      "title": "Old Arrow Maker",
      "artist": "Edmonia Lewis",
      "description": "대리석 작품을 디지털로 기록한 3D 모델입니다.",
      "asset": Object.freeze({
        "sha256": "13e430d0eb72d5e2a4ef0717e5f69d56ed3d0b76b0ee0e8d987d4e3d283f3bbe",
        "bytes": 1415084,
        "mime": "model/gltf-binary"
      }),
      "dimensions": Object.freeze({
        "depth": 0.34526312351226807,
        "width": 0.34847164154052734,
        "height": 0.54190900750109
      }),
      "roomId": "f9b45fa2-3325-4d97-87d4-d48a491ad87e",
      "placement": Object.freeze({
        "scale": Object.freeze([
          1,
          1,
          1
        ]),
        "position": Object.freeze([
          0,
          1.1709545037505449,
          0
        ]),
        "rotation": Object.freeze([
          0,
          0,
          0,
          1
        ])
      })
    })
  ]),
  "unresolved": Object.freeze([
    Object.freeze({
      "roomRole": "painting",
      "artworkType": "painting",
      "count": 6,
      "reason": "Admitted artwork packets and fit decisions are pending."
    }),
    Object.freeze({
      "roomRole": "transition",
      "artworkType": "painting",
      "count": 3,
      "reason": "Admitted artwork packets and fit decisions are pending."
    }),
    Object.freeze({
      "roomRole": "closing",
      "artworkType": "painting",
      "count": 2,
      "reason": "Admitted artwork packets and fit decisions are pending."
    }),
    Object.freeze({
      "roomRole": "transition",
      "artworkType": "sculpture",
      "count": 1,
      "reason": "Admitted sculpture and clear-path fit are pending."
    }),
    Object.freeze({
      "roomRole": "sculpture",
      "artworkType": "sculpture",
      "count": 3,
      "reason": "Admitted sculptures and orbit-clearance fit are pending."
    })
  ])
});
