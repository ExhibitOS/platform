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
});
