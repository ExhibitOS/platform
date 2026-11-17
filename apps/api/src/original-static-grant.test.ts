// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {originalStaticGrant} from './original-static-grant.ts';

const rights={holder:'The Metropolitan Museum of Art',ownership:'authorized-licensee',licenseId:'CC0-1.0',creditLine:'Met',permissions:{display:true,download:true,export:true,commercial:true}};
const input={approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',workspaceId:'workspace',tenantId:'tenant',principalId:'principal',artworkId:'artwork',artworkRevision:2,artworkRevisionId:'revision',jobId:'job',originalAssetId:'source',primaryAssetId:'prepared',sha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',bytes:8291194,mime:'image/jpeg',rights};
describe('exact original static grant',()=>{
 it('records the separately attested source and its current owner/revision without approving a renderer',()=>{
  const grant=originalStaticGrant(input)!;
  expect(grant).toMatchObject({workspaceId:'workspace',artworkRevisionId:'revision',originalAssetId:'source',primaryAssetId:'prepared',source:{sha256:input.sha256,bytes:input.bytes,mime:'image/jpeg'},uses:{publicNetwork:true,durableRedistribution:true}});
  expect(grant).not.toHaveProperty('featureReport');
 });
 it('omits other files and rights that do not permit durable source delivery',()=>{
  expect(originalStaticGrant({...input,sha256:'0'.repeat(64)})).toBeUndefined();
  expect(originalStaticGrant({...input,bytes:input.bytes-1})).toBeUndefined();
  expect(originalStaticGrant({...input,approvalId:'another'})).toBeUndefined();
  expect(originalStaticGrant({...input,rights:{...rights,expiresAt:'2099-01-01T00:00:00Z'}})).toBeUndefined();
  for(const permission of ['display','export','download'] as const)expect(originalStaticGrant({...input,rights:{...rights,permissions:{...rights.permissions,[permission]:false}}})).toBeUndefined();
 });
});

it('constructs a source-specific grant from verified owner lineage and current rights',()=>{
 const source={...input,approvalId:undefined,sha256:'a'.repeat(64),bytes:420};
 const lineage={preparation:{jobId:source.jobId,sha256:source.sha256},coarse:{sha256:'b'.repeat(64)}};
 const grant=originalStaticGrant(source,undefined,lineage)!;
 expect(grant).toMatchObject({approvalId:source.jobId,source:{sha256:source.sha256,bytes:420},rightsEvidenceEncoding:'freeze-canonical-utf8'});
 expect(originalStaticGrant(source)).toBeUndefined();
 expect(originalStaticGrant({...source,approvalId:input.approvalId},undefined,lineage)).toBeUndefined();
 expect(originalStaticGrant({...source,rights:{...rights,permissions:{...rights.permissions,download:false}}},undefined,lineage)).toBeUndefined();
 expect(originalStaticGrant(source,undefined,{...lineage,coarse:{sha256:'c'.repeat(64)}})?.provenanceSha256).not.toBe(grant.provenanceSha256);
});
