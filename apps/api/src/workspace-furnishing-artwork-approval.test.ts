// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {Artwork} from '@exhibitos/spec';
import type {PoolClient} from 'pg';
import {ApiError,type Session} from './auth.ts';
import {Cms} from './cms.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
afterEach(()=>vi.restoreAllMocks());
it('rebinds the exact image to its live CMS approval and current rights',async()=>{
 const tenantId=crypto.randomUUID(),userId=crypto.randomUUID(),owner={workspaceId:crypto.randomUUID(),tenantId,principalId:userId,assertDatabase:vi.fn(async()=>{})},service=new WorkspaceFurnishingIntakes({} as never,owner),client={} as PoolClient,session={tenantId,userId,role:'artist'} as Session;
 const artwork={id:crypto.randomUUID(),revisionId:crypto.randomUUID(),primaryAssetId:crypto.randomUUID(),dimensions:{width:.6,height:.8}} as Artwork,lookup=vi.spyOn(Cms.prototype,'studioArtwork').mockResolvedValue({artwork,previewUrl:''} as never);
 await expect(service.checkArtwork(client,session,structuredClone(artwork))).resolves.toBeUndefined();expect(lookup).toHaveBeenCalledWith(client,session,artwork.id);
 for(const change of [{revisionId:crypto.randomUUID()},{primaryAssetId:crypto.randomUUID()},{dimensions:{width:.6,height:.6}}])await expect(service.checkArtwork(client,session,{...artwork,...change})).rejects.toMatchObject({code:'ARTWORK_SNAPSHOT_CHANGED'});
 lookup.mockRejectedValueOnce(new ApiError(409,'REVISION_NOT_APPROVED'));await expect(service.checkArtwork(client,session,artwork)).rejects.toMatchObject({code:'REVISION_NOT_APPROVED'});
 lookup.mockRejectedValueOnce(new ApiError(403,'RIGHTS_DENIED'));await expect(service.checkArtwork(client,session,artwork)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
 await expect(service.checkArtwork(client,{...session,userId:crypto.randomUUID()},artwork)).rejects.toMatchObject({code:'FORBIDDEN'});
});
