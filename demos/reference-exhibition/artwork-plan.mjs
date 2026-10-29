// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not a deployment or runtime acceptance claim.
const freeze = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const DEMO_ARTWORK_PLAN = freeze({
  "version": 1,
  "base": {
    "exhibitionId": "36544ec8-7937-4de9-9a47-da7cef4872f2",
    "revisionSha256": "5bcb6ddb799976bb5f5b1424b583c0942ef4857c9d64427c1447f543442c08a0",
    "rooms": [
      {
        "role": "entry",
        "id": "b051d931-2c7c-4efb-a994-29dee9be29a0",
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
        "id": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
        "id": "ba82d27b-73d2-45f3-a048-0af791ea2313",
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
        "id": "f12feb59-ba66-4268-9efb-28a9dd7c789c",
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
        "id": "9ab35831-1002-4610-9d5d-4f5a19bcd422",
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
        "a": "ff525e57-c9b2-43e1-9216-3f2878c84f03",
        "b": "d3c0946e-6d52-4ad9-9609-d416f4e45813"
      },
      {
        "a": "abffbc0b-5bb4-4c44-8508-f24a9a05eff8",
        "b": "6e3dc30a-3baf-4e4d-86fa-4565a42a81d1"
      },
      {
        "a": "7aaf3dfe-f37c-4432-8d15-dfc795d95da3",
        "b": "0b7f5def-8e09-4789-9932-f813238d9f4c"
      },
      {
        "a": "22ab2dde-8079-4662-888b-aab875329558",
        "b": "c684c9ba-1868-46fd-a7f9-fb3fed5517ed"
      },
      {
        "a": "1331c3aa-6911-48d8-88cf-a407840dba3f",
        "b": "eb7c96ae-3777-48a9-8f2d-1742bd0408e2"
      }
    ]
  },
  "targets": {
    "paintings": 14,
    "sculptures": 5
  },
  "entries": [
    {
      "planId": "16d200f6-d16a-441f-851c-2f89b86880c8",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "1b1218d7-6dd4-4395-a626-47300419d3f7",
      "artworkRevisionId": "034edba4-f32a-4db3-9077-8b0bf300d499",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
      "planId": "9ed45fd2-a62a-4e74-aedf-8623a40d225d",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "ffa639e9-cfe8-4b62-90bb-55b8b7527000",
      "artworkRevisionId": "662b0571-7378-4ef1-8ddd-127915e65b92",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
      "planId": "c71ffa65-bdbc-4fd3-95a4-a429d58ba719",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "3431468a-acbf-4f4f-bd22-356901b9184a",
      "artworkRevisionId": "b59d86c6-7bf5-41e0-a8b8-7e759bb0f289",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
      "planId": "f8c13dc0-627e-4eb9-b038-e41d9f6e8e97",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "f882a642-b0e6-4951-bda7-c6a6fa3c3825",
      "artworkRevisionId": "f92068e1-760f-4ab1-b7b4-8ea2d33b6037",
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
      "roomId": "f12feb59-ba66-4268-9efb-28a9dd7c789c",
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
      "planId": "b018e4b0-bd2e-422d-bc93-b4067cbf865a",
      "sourceKey": "met-437881",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437881",
      "artworkId": "9b932367-13be-4891-9185-45df695270fc",
      "artworkRevisionId": "476f2fdd-55a6-4906-b298-ce9144528439",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
      "planId": "e844dd44-e1fb-49d6-ba4d-931431df0982",
      "sourceKey": "met-10158",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/10158",
      "artworkId": "35739114-7a96-4c7e-a588-6ed2a7608bb6",
      "artworkRevisionId": "dee2e9dc-3f04-46b4-95d7-b70c0d2b2b17",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
      "planId": "33f61ca3-f581-4c12-a6fb-c26ef8f236ba",
      "sourceKey": "met-436140",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436140",
      "artworkId": "01a209ce-b231-4cf2-a13a-45f4d54f8a5e",
      "artworkRevisionId": "94fa26f9-bc4a-47ba-b79b-1eff7cfe8096",
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
      "roomId": "d273fe75-fb17-48c4-9b69-22462d2eb028",
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
