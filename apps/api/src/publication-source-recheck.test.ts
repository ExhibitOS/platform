// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import type {PoolClient} from 'pg';
import {recheckPublicationSources} from './publication.ts';
import {Cms} from './cms.ts';
import {ApiError,type Session} from './auth.ts';
const c={} as PoolClient,s={} as Session;
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
async function fixture(){const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;candidate.mediaAssets=[];return candidate;}
it('reuses current CMS authority and refuses changed or revoked source approval',async()=>{
 const candidate=await fixture(),cms=new Cms(),approved=vi.spyOn(cms,'studioArtwork').mockImplementation(async(_c,_s,id)=>({artwork:candidate.artworks.find(a=>a.id===id)!,previewUrl:''}));
 await expect(recheckPublicationSources(c,s,candidate,candidate.id,cms)).resolves.toBeUndefined();
 approved.mockImplementation(async(_c,_s,id)=>({artwork:{...candidate.artworks.find(a=>a.id===id)!,metadata:{...candidate.artworks[0]!.metadata,title:'changed'}},previewUrl:''}));
 await expect(recheckPublicationSources(c,s,candidate,candidate.id,cms)).rejects.toMatchObject({code:'ARTWORK_SNAPSHOT_CHANGED'});
 approved.mockRejectedValue(new ApiError(403,'RIGHTS_DENIED'));await expect(recheckPublicationSources(c,s,candidate,candidate.id,cms)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
});
it('rejects an earlier source grant expiring during later source queries',async()=>{
 const candidate=await fixture(),cms=new Cms();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
 candidate.artworks[0]!.rights.expiresAt='2026-10-31T12:00:01Z';
 vi.spyOn(cms,'studioArtwork').mockImplementation(async(_c,_s,id)=>{const artwork=candidate.artworks.find(a=>a.id===id)!;if(id===candidate.artworks.at(-1)!.id)vi.setSystemTime(new Date('2026-10-31T12:00:02Z'));return {artwork,previewUrl:''};});
 await expect(recheckPublicationSources(c,s,candidate,candidate.id,cms)).rejects.toMatchObject({code:'PUBLICATION_NOT_READY'});
});
