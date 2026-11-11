// SPDX-License-Identifier: AGPL-3.0-or-later
import {USER_ASSET_CATALOGUE,type UserAssetCatalogueEntry} from './user-asset-catalogue.js';
// Managed source32d producer receipt and default-furnishings1.8 bind these bytes.
// Historical catalogue data remains intact; only the current functional lookup uses this record.
const historical=USER_ASSET_CATALOGUE.find(entry=>entry.id==='museum-wallwasher');
if(!historical)throw Error('PREPARED_SHARED_FIXTURE_MISSING');
const root='assets/furnishings/exhibitos-authored-20261111/museum-wallwasher';
export const PREPARED_SHARED_FIXTURES:Readonly<Record<string,UserAssetCatalogueEntry>>=Object.freeze({
 'museum-wallwasher':Object.freeze<UserAssetCatalogueEntry>({...historical,path:root+'/model.glb',
  rights:{licenseId:'CC0-1.0',noticePath:root+'/LICENSE-NOTICE.txt',noticeBytes:1115,noticeSha256:'b40713d9c089649c71aeed2c8fced9d9274612ef376b77d19ab5f6becd5b0cf3'},
  provenance:{sourceSha256:historical.provenance.sourceSha256,recipe:'omit-unused-invalid-tangent-r1'},
  preparation:{files:[
   {path:root+'/source.glb',bytes:201736,sha256:'d85d9d1823c49bef412a23a59e238104f5b8ad342d8e8149efaf8d1110dc3290'},
   {path:root+'/source-LICENSE-NOTICE.txt',bytes:724,sha256:'e5fc8abc780384bcc336e807a920939a3e96de36931d6d482dbde438312454ff'},
   {path:root+'/producer-receipt.json',bytes:1967,sha256:'02cbb0ac1bbc5aabfe7815b9b2d5beccca47a1f583d912c928b23bea4b682e47'},
   {path:root+'/integrity.json',bytes:2187,sha256:'ac33494a205cdada045b11eedc7f52508f9f322ead832480f9456afd2b0b8ac1'},
  ]},
 }),
 'museum-wallwasher-rear-relief':Object.freeze<UserAssetCatalogueEntry>({
  "id": "museum-wallwasher-rear-relief",
  "version": 1,
  "mime": "model/gltf-binary",
  "path": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/model.glb",
  "bytes": 203836,
  "sha256": "7c1c7bb441031b7496c80d1bd39edb66b31346887e928ce68a0f22fbf9bf7f8f",
  "triangles": 2584,
  "bounds": {
    "min": [
      -0.12099999934434891,
      -0.15000000596046448,
      -0.052999999141320586
    ],
    "max": [
      0.12099999934434891,
      0,
      0.05000000074505806
    ]
  },
  "rights": {
    "licenseId": "CC0-1.0",
    "noticePath": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/LICENSE-NOTICE.txt",
    "noticeBytes": 1321,
    "noticeSha256": "02f6e4b864a64ca10a4b9b52c4da1749eeca402f7b3d225db784051c95c0aaf8"
  },
  "provenance": {
    "sourceSha256": "6c77c618f040e673edbc1ffbd67f48c79deed6d11286474830b12d9cd6ba0823",
    "recipe": "omit-unused-invalid-tangent-r1"
  },
  "functional": {
    "kind": "light",
    "evidence": "actual-glb-geometry",
    "consumerBehavior": "unverified",
    "apertureCentre": [
      0,
      -0.106,
      -0.05
    ],
    "apertureDesignation": "authored-reference",
    "aim": [
      0,
      0,
      -1
    ],
    "pivot": [
      0,
      -0.084,
      0
    ],
    "pivotAxis": [
      1,
      0,
      0
    ],
    "opaqueLensContact": [
      0,
      -0.106,
      -0.015000000479631126
    ]
  },
  "preparation": {
    "files": [
      {
        "path": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/source.glb",
        "bytes": 203848,
        "sha256": "6c77c618f040e673edbc1ffbd67f48c79deed6d11286474830b12d9cd6ba0823"
      },
      {
        "path": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/source-LICENSE-NOTICE.txt",
        "bytes": 930,
        "sha256": "eef681a28e50d647ef1302c294f4b7886164b23d3e134e521c76d7d8c4f4b9ad"
      },
      {
        "path": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/producer-receipt.json",
        "bytes": 1967,
        "sha256": "fa940186e1cdc4e418f27aaec6b94b33f3898ced22e8b4405899dc1213f5ce56"
      },
      {
        "path": "assets/furnishings/exhibitos-authored-20261111/museum-wallwasher-rear-relief/integrity.json",
        "bytes": 2187,
        "sha256": "8168af01d4e8f9a84cdcd9e071291412761e4be36ffcc6001142bc120ba49d9a"
      }
    ]
  }
}),
});
