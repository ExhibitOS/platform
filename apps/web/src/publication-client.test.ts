// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {publish} from './publication-client';
import type {Session} from './cms-client';
afterEach(()=>vi.unstubAllGlobals());
it('uses owned native staging for a workspace furnishing publication',async()=>{
 const fetcher=vi.fn(async()=>Response.json({publicationId:'synthetic'}));vi.stubGlobal('fetch',fetcher);const session={tenantId:'tenant',userId:'user',role:'admin',csrfToken:'token',expiresAt:'2030-01-01T00:00:00Z',nativePublicationProfile:'bounded-local-v1'} as Session;
 await publish(session,'exhibition','etag','request',true);expect(fetcher).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({headers:expect.objectContaining({'x-exhibitos-publication-profile':'bounded-local-v1'})}));
 await expect(publish({...session,nativePublicationProfile:undefined},'exhibition','etag','request',true)).rejects.toMatchObject({code:'PUBLICATION_STAGE_UNAVAILABLE'});expect(fetcher).toHaveBeenCalledTimes(1);
});
