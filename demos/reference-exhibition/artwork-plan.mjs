// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not a deployment or runtime acceptance claim.
const freeze = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const DEMO_ARTWORK_PLAN = freeze({
  "version": 1,
  "base": {
    "exhibitionId": "479f7f29-aa74-4884-831c-e62de7f7ab4c",
    "revisionSha256": "b30fd15c37642a1ec54bd547d80fa963e9e02883449074b1ec0c1251d1764ce8",
    "rooms": [
      {
        "role": "entry",
        "id": "59a34e91-0d21-435e-bbf6-53ae39cf470c",
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
        "id": "169309c5-4742-4177-b9f1-444860bac3e4",
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
        "id": "02dc703c-8068-4265-8520-39193839d2f1",
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
        "id": "2df5aba9-fc51-490e-b12f-f454d0920e87",
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
        "id": "bee1cdfc-9cd3-43ce-a38a-358b00cae4d9",
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
        "a": "f34d6d43-9b30-4438-bcd2-cdc498762790",
        "b": "1e898791-5217-4432-90ed-9a83b62a4180"
      },
      {
        "a": "8f061863-4d8f-499f-b4f6-f6cfcb6eec1f",
        "b": "cc558808-c63c-419f-8772-0fc04ccd4a66"
      },
      {
        "a": "9121bfe5-d59f-4ede-ba4a-898c107548a7",
        "b": "427ecc24-a86f-4c28-8067-a040119a3bf9"
      },
      {
        "a": "3ccaac63-5a60-4c44-872a-2a1be9889723",
        "b": "c8d8f4fb-4950-424d-b694-26e8a6d0e056"
      },
      {
        "a": "a24c19f6-8e9c-490f-9e1c-ea374101a275",
        "b": "6bf311c1-b59f-40cd-ac89-68dc66c1a46d"
      }
    ]
  },
  "targets": {
    "paintings": 14,
    "sculptures": 5
  },
  "entries": [
    {
      "planId": "f0966090-d62b-4e0d-8fb8-bbb72ae8ee0b",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "7ee53670-24bb-4db6-bca8-a6bd736c5aa8",
      "artworkRevisionId": "d0c49993-b861-4f22-8713-b039e1fb0bde",
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
      "roomId": "169309c5-4742-4177-b9f1-444860bac3e4",
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
      "planId": "0af21f1b-efb2-4fff-9294-031861b6c0f0",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "02d2899c-6639-4417-92a8-69961b699537",
      "artworkRevisionId": "baac3ac5-68c2-4466-9c21-643ad06c7eca",
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
      "roomId": "169309c5-4742-4177-b9f1-444860bac3e4",
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
      "planId": "b8d05a4d-4f66-47c3-85e6-2cbee5e6dc54",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "9f251330-56e9-494b-9bc2-287d24cf1c76",
      "artworkRevisionId": "e59707d2-06c5-4260-b2d9-f2b4b11d0140",
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
      "roomId": "169309c5-4742-4177-b9f1-444860bac3e4",
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
      "planId": "4f405b06-4812-4bf0-8f9f-249fb43e4b43",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "0a8d2871-1d5b-40e3-949f-bb8d88f57167",
      "artworkRevisionId": "efbaa939-0478-4f5c-b371-ff3d4576c13b",
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
      "roomId": "2df5aba9-fc51-490e-b12f-f454d0920e87",
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
      "planId": "9ef0a975-acf3-44bb-82d2-ceda283a06ac",
      "sourceKey": "met-437881",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437881",
      "artworkId": "151197ce-7763-456a-8a46-ed7c796984ac",
      "artworkRevisionId": "b3a40d69-8200-447d-9a79-41f60fb1cb44",
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
      "roomId": "169309c5-4742-4177-b9f1-444860bac3e4",
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
      "planId": "5c6d5496-ecc3-4b0f-8a59-781540ec32b5",
      "sourceKey": "met-10158",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/10158",
      "artworkId": "d4b6d0f2-05b0-48a1-b8e8-ffff331e9411",
      "artworkRevisionId": "39576bfd-2488-449c-b020-055b6fdeb697",
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
      "roomId": "169309c5-4742-4177-b9f1-444860bac3e4",
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
    }
  ],
  "unresolved": [
    {
      "roomRole": "painting",
      "artworkType": "painting",
      "count": 4,
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
