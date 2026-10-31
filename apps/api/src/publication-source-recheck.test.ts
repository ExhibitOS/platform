// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileBlobStore} from '@exhibitos/storage';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {PublicationAttempts} from './publication-attempt.ts';
import {PublicationFileOperation} from './publication-file-operation.ts';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import type {Pool,PoolClient} from 'pg';
import {Publications,recheckPublicationSources,type PublicationIssue} from './publication.ts';
import {PublicationByteStage} from './publication-byte-stage.ts';
import {Studio} from './studio.ts';
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
it.each(['close','verify'])('does not return admitted READY if a display grant expires during final %s',async phase=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-ready-expiry-')));
 const dirs=await Promise.all(['budget-','blobs-','journal-','scratch-'].map(prefix=>mkdtemp(join(root,prefix)))),coordinator=await PublicationDiskBudget.open(dirs[0]!),blobs=new FileBlobStore(dirs[1]!);
 const candidate=await fixture(),publisher=new Publications({} as Pool,blobs),client={query:vi.fn(async()=>({rows:[{system_id:'123',database_oid:'456'}]}))} as unknown as PoolClient,session={tenantId:randomUUID(),userId:randomUUID()} as Session;
 const request={kind:'readiness' as const,attemptId:randomUUID(),runtimeGeneration:randomUUID(),tenantId:session.tenantId,userId:session.userId,exhibitionId:candidate.id,requestId:randomUUID(),etag:''};
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
 candidate.artworks[0]!.rights.expiresAt='2026-10-31T12:00:01Z';
 const {etag}=await import('./studio.ts');request.etag=etag(2,{candidate});
 const op=await PublicationFileOperation.admit(client,{coordinator,blobs,journal:new PublicationAttempts(dirs[2]!),scratchRoot:dirs[3]!},request);
 try{
 vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision:2,metadata:{candidate}} as never);
 vi.spyOn(publisher as unknown as {prepare:()=>Promise<{issues:PublicationIssue[]}>},'prepare').mockResolvedValue({issues:[]});
 vi.spyOn(publisher.cms,'studioArtwork').mockImplementation(async(_c,_s,id)=>({artwork:candidate.artworks.find(a=>a.id===id)!,previewUrl:''}));
 const close=PublicationByteStage.prototype.close;
 vi.spyOn(PublicationByteStage.prototype,'close').mockImplementation(async function(this:PublicationByteStage){await close.call(this);if(phase==='close')vi.setSystemTime(new Date('2026-10-31T12:00:02Z'));});
 const verify=coordinator.verifyActive.bind(coordinator);let verifications=0;
 vi.spyOn(coordinator,'verifyActive').mockImplementation(async binding=>{await verify(binding);if(++verifications===2&&phase==='verify')vi.setSystemTime(new Date('2026-10-31T12:00:02Z'));});
 await expect(publisher.ready(client,session,candidate.id,op)).resolves.toMatchObject({status:'BLOCKED',issues:[{code:'PUBLICATION_NOT_READY'}]});
 }finally{await op.close();await rm(root,{recursive:true,force:true});}
});
