// SPDX-License-Identifier: AGPL-3.0-or-later
// The positive evidence is private and never committed to the source tree.
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {matchesPrivateWheatBinding,matchesPrivateWheatGrant,matchesPrivateWheatOwner} from './private-wheat-candidate-pin.ts';
import {hasQualifiedOriginalImageModel,qualifiedOriginalImageModel} from './native-original-image-model.ts';
import type {NativeDetailContext} from './native-detail-context.ts';
import type {Session} from './auth.ts';
it.skipIf(!process.env.PRIVATE_WHEAT_GRANT_EVIDENCE)('admits only the actual pinned grant, owner, exhibition and exact measured source',async()=>{
 const data=JSON.parse(await readFile(process.env.PRIVATE_WHEAT_GRANT_EVIDENCE!,'utf8')),grant=data.grant.metadata,context={owner:{workspaceId:grant.workspaceId,tenantId:grant.tenantId,principalId:grant.principalId}} as NativeDetailContext,session={tenantId:grant.tenantId,userId:grant.principalId} as Session,exhibition='8a751f8a-281e-4b37-a7b7-c7804f25c7d3';
 expect(matchesPrivateWheatGrant(grant)).toBe(true);expect(matchesPrivateWheatOwner(context,session,exhibition)).toBe(true);expect(hasQualifiedOriginalImageModel(context,session,exhibition)).toBe(true);expect(hasQualifiedOriginalImageModel()).toBe(false);expect(hasQualifiedOriginalImageModel(context,session,'00000000-0000-4000-8000-000000000000')).toBe(false);
 const binding={artworkId:grant.artworkId,artworkRevision:grant.artworkRevision,importJobId:grant.jobId,grant};expect(matchesPrivateWheatBinding(binding)).toBe(true);expect(matchesPrivateWheatBinding({...binding,artworkRevision:grant.artworkRevision+1})).toBe(false);
 for(const value of [{...grant,jobId:'00000000-0000-4000-8000-000000000000'},{...grant,rights:{...grant.rights,licenseId:'other'}},{...grant,unexpected:true}])expect(matchesPrivateWheatGrant(value)).toBe(false);
 const input={sha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',bytes:8291194,width:4000,height:3184,iccSha256:'f6bd2776ef85c5a0a9313989eb60f3db7996bc4af48453353f53840643d8e32b'};expect(qualifiedOriginalImageModel(input)).toEqual({model:'wheat-m1-chrome156-private-384-v1',residentBytes:163942340,peakAdditionalBytes:402653184});expect(qualifiedOriginalImageModel({...input,iccSha256:null})).toBeUndefined();expect(qualifiedOriginalImageModel({...input,width:3999})).toBeUndefined();
});
