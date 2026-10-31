// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not a deployment or runtime acceptance claim.
const freeze = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const DEMO_ARTWORK_PLAN = freeze({
  "version": 1,
  "base": {
    "exhibitionId": "ac538a3f-5552-48ec-81d2-00cc7bb3427d",
    "revisionSha256": "dc51d914b1866aafdc604568cf6b5a8667fb912e0820f3be84518b1c7745a53f",
    "rooms": [
      {
        "role": "entry",
        "id": "80cf19f2-8a04-429f-b27e-2a77a463f9b4",
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
        "id": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
        "id": "2dc7bda4-9400-4f75-a313-b507b122dd37",
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
        "id": "b50b53d6-1989-457a-bb79-a7fe4bab2457",
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
        "id": "d0c6a355-84c3-4efa-a221-0afae1dc8bc8",
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
        "a": "b627a293-2801-40e8-a905-06f41d5f87ff",
        "b": "a8b2c105-503b-40cc-abcc-60295c015f9f"
      },
      {
        "a": "7890c88e-a741-419a-aad5-83f88b4728b4",
        "b": "16316d90-99de-42a1-bdb9-ba398eca9630"
      },
      {
        "a": "6bba33e7-2740-432d-9dba-7f1a90a11e11",
        "b": "521f1313-f44e-404d-b3b8-0a5fd0902960"
      },
      {
        "a": "ed7486e5-aed0-47d5-8c86-a140fb279ba3",
        "b": "c277e74c-d615-41a3-acca-4c709075d8c6"
      },
      {
        "a": "7b6d4a12-a1b5-473c-b0ff-48f13426b902",
        "b": "88315768-0af2-4867-b692-dd8455980283"
      }
    ]
  },
  "targets": {
    "paintings": 14,
    "sculptures": 5
  },
  "entries": [
    {
      "planId": "cdefc3b5-32a3-496a-9bc2-17c635326227",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "5ca04867-71ae-4c8a-a970-6f4b00c92bf6",
      "artworkRevisionId": "c74f2735-2f2b-4b79-be98-09aba68d11ea",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
      "planId": "edddd963-70a5-4177-9b3b-8b282badeaa7",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "7254ae9d-09f6-4c52-8dd7-bf697b7f7782",
      "artworkRevisionId": "2d4fec3e-ae5e-4c7d-acb4-9e8e97086ef9",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
      "planId": "28c04bb2-2e0d-49c6-ba26-a95e709e6dee",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "d74eb867-3ad8-4e95-bf69-5d1686ddeccb",
      "artworkRevisionId": "2c0be3de-41d2-450c-90a8-c90b5dadc1d2",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
      "planId": "1b69aee2-192a-4c31-bd5a-c8a89c756017",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "6a171b4c-822b-485e-8ba8-178e62cbccbb",
      "artworkRevisionId": "d7e3165b-7085-42fb-a227-719b43c32e81",
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
      "roomId": "b50b53d6-1989-457a-bb79-a7fe4bab2457",
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
      "planId": "a9a84227-b483-4e08-9093-2de5330be1a3",
      "sourceKey": "met-437881",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437881",
      "artworkId": "72b0d9fe-7ff6-4e88-8ffc-3e1476ae6326",
      "artworkRevisionId": "0e852ce9-c75a-4cb4-a197-8a0edc9d8938",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
      "planId": "02b7003b-8062-4ab9-b96d-872224870387",
      "sourceKey": "met-10158",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/10158",
      "artworkId": "513af28b-e0ec-44bf-8d0e-36a2ed5b9b83",
      "artworkRevisionId": "6dac5975-787a-4629-bd2d-8c8633a44f46",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
      "planId": "50cf6a18-a027-49ec-8e4c-8d15a2a50b67",
      "sourceKey": "met-436140",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436140",
      "artworkId": "554f6c64-ce13-40e9-acb9-814215473e41",
      "artworkRevisionId": "23d5ad76-82f4-4066-89da-14d996481ef4",
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
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
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
    },
    {
      "planId": "a27bc3fa-8dc3-41b7-958f-a7f68b8c7ac7",
      "sourceKey": "met-437159",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437159",
      "artworkId": "6d30be82-f45c-4644-843a-2c5e0e75c420",
      "artworkRevisionId": "6ccca71e-9030-4e92-8a71-a4889037c04d",
      "artworkType": "painting",
      "title": "Young Woman Knitting",
      "artist": "Berthe Morisot",
      "description": "모자를 쓴 여성이 야외에서 의자에 앉아 뜨개질을 하고 있다. 뒤에는 초록 식물과 꽃이 보이고, 곁에는 빈 의자가 놓여 있다.",
      "asset": {
        "sha256": "ffe480aae3f3331c894e22e6e64fe68eb36af602963d96661aebbda6fe31890f",
        "bytes": 6755174,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.6005366467442592,
        "height": 0.502
      },
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          3.94,
          1.5,
          -2.5
        ],
        "rotation": [
          0,
          -0.7071067811865476,
          0,
          0.7071067811865476
        ]
      }
    },
    {
      "planId": "0c41e2ab-5afc-4d2c-9cea-b21c6afe30ac",
      "sourceKey": "met-437308",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437308",
      "artworkId": "41ee431f-a8e3-4525-8b1a-3ec109101cc2",
      "artworkRevisionId": "199404ca-0cf1-4538-8ebb-2431ddd7f12c",
      "artworkType": "painting",
      "title": "Morning, An Overcast Day, Rouen",
      "artist": "Camille Pissarro",
      "description": "흐린 하늘 아래 강을 가로지르는 다리와 배들이 보인다. 강 너머로 건물과 연기가 나는 굴뚝이 이어진다.",
      "asset": {
        "sha256": "3bd86b148feb25fac1c64132895416d5375997f45a1a6060f0ea3316a63d431d",
        "bytes": 7521849,
        "mime": "image/png"
      },
      "dimensions": {
        "width": 0.6480197802197802,
        "height": 0.543
      },
      "roomId": "2b2bd774-be1e-49d7-8a45-8296c0004f22",
      "placement": {
        "scale": [
          1,
          1,
          1
        ],
        "position": [
          -3.94,
          1.5,
          2.5
        ],
        "rotation": [
          0,
          0.7071067811865476,
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
      "count": 1,
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
