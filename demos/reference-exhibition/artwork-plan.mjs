// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-bound planning data, not a deployment or runtime acceptance claim.
const freeze = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const DEMO_ARTWORK_PLAN = freeze({
  "version": 1,
  "base": {
    "exhibitionId": "f33557c4-1cd6-4dca-9b55-c5e8e0105484",
    "revisionSha256": "e8eb1efa20342eaa26a5c7174f0d2433f8e69266e9c73f73cfd42318eb0dd579",
    "rooms": [
      {
        "role": "entry",
        "id": "8b85de2e-17bd-430a-9a5e-1dc7780d3c81",
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
        "id": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
        "id": "f52601cb-a9f3-43ea-b2c3-c194c029b26a",
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
        "id": "ab375dfd-5151-4a24-8385-e14195def88c",
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
        "id": "c04b314c-ac7c-45f3-a4c1-7e844712d566",
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
        "a": "49bf6be0-a6af-49bc-b897-50c60161fd53",
        "b": "64137e6f-ff6d-45b0-b595-5af0ee425ab3"
      },
      {
        "a": "855d7e87-954f-481d-8810-98806135cdbf",
        "b": "0248b401-bd28-4545-8b98-e57350020d1c"
      },
      {
        "a": "7902dd5a-09f9-4a1b-8655-540044ad8e3d",
        "b": "54931ddc-dbe6-4465-ac16-f4acbdfdb049"
      },
      {
        "a": "7522c165-a418-43fc-830f-aeb12381e29e",
        "b": "1da8838e-043d-4e92-926e-3caa2815a430"
      },
      {
        "a": "3a16c198-8121-4471-86c2-8791ebed7f01",
        "b": "94410f5c-e764-41c3-a2df-43da744ad4a5"
      }
    ]
  },
  "targets": {
    "paintings": 14,
    "sculptures": 5
  },
  "entries": [
    {
      "planId": "e5831c10-e7a1-44f7-8f24-6fb3dfe7cf2e",
      "sourceKey": "met-436535",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436535",
      "artworkId": "cdd8c30a-370d-436f-9e2f-6426770b99c7",
      "artworkRevisionId": "fa382eeb-2a22-48f1-a3b8-da4fe286f369",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "e1644c0c-279a-4b6f-8724-c1d1e2d3cdac",
      "sourceKey": "met-437394",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437394",
      "artworkId": "27cf795e-eca2-47b0-a266-a4852deb2aef",
      "artworkRevisionId": "f21f6cb4-7e69-421d-a11f-6ccb6a406d6b",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "fcb53335-def1-4a0c-9710-5e70f9fb573e",
      "sourceKey": "met-435883",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/435883",
      "artworkId": "bcc8547f-7fa6-4516-8672-67414e81948d",
      "artworkRevisionId": "126b7da9-454c-4038-9914-ba43d76023f6",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "689cd853-a851-4a4d-996e-cabf4fceb789",
      "sourceKey": "si-99ca3d6f-6d54-45a5-9b95-f8c245a662c2",
      "officialObjectIdOrURL": "https://americanart.si.edu/artwork/old-arrow-maker-14629",
      "artworkId": "36b19f30-eb07-4f30-a097-7f7513ae3410",
      "artworkRevisionId": "2026e727-ee9c-4b2c-a692-b5bb2d403fbb",
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
      "roomId": "ab375dfd-5151-4a24-8385-e14195def88c",
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
      "planId": "c7cc5dbb-92e8-40f4-b391-8ba2bd82ebc6",
      "sourceKey": "met-437881",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437881",
      "artworkId": "b250e19d-d66f-4f81-bd7e-ca2088bd17a1",
      "artworkRevisionId": "1299df4f-3cdb-4260-af8f-e7f167aa401d",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "d49f2ccc-e878-42a2-b28f-9f8e146018ff",
      "sourceKey": "met-10158",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/10158",
      "artworkId": "c8c81cad-5199-4d23-acfc-102bba1a9fc9",
      "artworkRevisionId": "40633830-a330-4762-9e21-4d4d34d44262",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "2bf2678d-d050-476b-b9a6-c9711c1e6ace",
      "sourceKey": "met-436140",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/436140",
      "artworkId": "bf0dd0c3-f7ac-4b69-aa56-2c1c0580f9f0",
      "artworkRevisionId": "20529e44-4820-41db-bae5-420f4b7103a4",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
      "planId": "70186a07-71a0-427a-a4d8-7198e2493efd",
      "sourceKey": "met-437159",
      "officialObjectIdOrURL": "https://www.metmuseum.org/art/collection/search/437159",
      "artworkId": "d7b5bd41-2ed5-46a5-b352-0bfe7e2bc314",
      "artworkRevisionId": "fd2ff398-b989-4153-a4f9-279888175b59",
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
      "roomId": "244c338c-1176-488f-a577-2b7e6e5cfc1a",
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
    }
  ],
  "unresolved": [
    {
      "roomRole": "painting",
      "artworkType": "painting",
      "count": 2,
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
