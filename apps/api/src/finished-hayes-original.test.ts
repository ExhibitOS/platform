// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it,vi,beforeEach} from 'vitest';
import type {PoolClient} from 'pg';
import {FileBlobStore,sha256,type BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import type {Imports} from './imports.ts';
import type {Cms} from './cms.ts';
import type {Studio} from './studio.ts';
import {etag} from './studio.ts';
import {prepareRequiredModelOriginals,persistRequiredModelOriginal,readBoundModelOriginal} from './required-model-original-binding.ts';
import {revisionHash} from '@exhibitos/spec';
import {createNativeOriginalPublication} from './native-original-publication.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import {FINISHED_HAYES_ORIGINAL_PROFILE,resolveFinishedHayesCandidate,approveFinishedHayesOriginal,readFinishedHayesOriginalApproval,readApprovedFinishedHayesOriginal,type FinishedHayesOriginalApproval} from './finished-hayes-original.ts';

// Isolate the new source adapter. The existing canonical release verifier,
// disposition parser and GLB inspector retain their independent tests.
const seams=vi.hoisted(()=>({released:vi.fn(),issued:vi.fn(),parse:vi.fn(),match:vi.fn(),inspect:vi.fn()}));
vi.mock('@exhibitos/storage',async actual=>({...await actual<typeof import('@exhibitos/storage')>(),confirmedHayesReleaseBindings:seams.released}));
vi.mock('./hayes-original-attempt.ts',async actual=>({...await actual<typeof import('./hayes-original-attempt.ts')>(),isHayesReleaseContext:seams.issued}));
vi.mock('./hayes-disposition-receipt.ts',()=>({parseHayesDispositionReceipt:seams.parse,matchHayesDispositionReceipt:seams.match}));
vi.mock('./native-detail-context.ts',async actual=>({...await actual<typeof import('./native-detail-context.ts')>(),isIssuedNativeDetailContext:()=>true}));
vi.mock('./adopted-model-detail-report.ts',()=>({inspectAdoptedModelDetail:seams.inspect}));
beforeEach(()=>{vi.clearAllMocks();seams.issued.mockReturnValue(true);});

function setup(){
 const s={id:randomUUID(),expiresAt:'2099-01-01T00:00:00Z',tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const draft=newDraft(),art=syntheticArtwork('sculpture'),jobId=randomUUID(),attemptId=randomUUID(),receiptId=randomUUID(),stageId=randomUUID(),originalId=randomUUID(),derivativeId=randomUUID();
 const originalBytes=Buffer.alloc(128,1),displayBytes=Buffer.alloc(96,2),workspaceId=randomUUID();
 art.rights={holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,export:true,download:true,commercial:false}};
 art.assets[0]!.sha256=sha256(displayBytes);art.assets[0]!.bytes=displayBytes.length;
 draft.candidate.artworks=[art];
 const owner={workspaceId,tenantId:s.tenantId,principalId:s.userId,assertDatabase:vi.fn(async()=>{}),matchesBlobRoot:()=>true};
 const job={id:jobId,user_id:s.userId,artwork_id:art.id,state:'approved',asset_id:art.primaryAssetId,hayes_attempt_id:attemptId,
  hayes_disposition_id:receiptId,rights:art.rights,expected_hash:sha256(originalBytes),expected_bytes:originalBytes.length,object_key:'quarantine-source',approved_key:'released-display'};
 const release={tenant_id:s.tenantId,job_id:jobId,attempt_id:attemptId,disposition_id:receiptId,stage_id:stageId,
  source_artwork_id:art.id,source_artwork_revision:art.revision,source_sha256:job.expected_hash,source_bytes:job.expected_bytes,
  original_asset_id:originalId,display_asset_id:art.primaryAssetId,derivative_id:derivativeId,receipt_canonical:Buffer.from('synthetic-canonical'),
  receipt_sha256:'c'.repeat(64),completion_frame_sha256:'d'.repeat(64),output_key:job.approved_key,output_sha256:sha256(displayBytes),output_bytes:displayBytes.length,
  native_owner_id:randomUUID(),runtime_manifest_sha256:'e'.repeat(64),worker_manifest_sha256:'f'.repeat(64),native_evidence_sha256:'1'.repeat(64),
  database_system_identifier:'123',database_oid:'456',attestation:{synthetic:true}};
 const binding={workspaceId,tenantId:s.tenantId,principalId:s.userId,artworkId:art.id,artworkRevision:art.revision,jobId,attemptId};
 seams.parse.mockReturnValue({value:{binding},sha256:release.receipt_sha256});seams.match.mockReturnValue({});
 const released=new Set([`import_jobs:${s.tenantId}:${jobId}`,`hayes_output_stages:${s.tenantId}:${stageId}`]);seams.released.mockResolvedValue(released);
 const original={id:originalId,object_key:job.object_key,target_key:job.object_key,sha256:job.expected_hash,bytes:originalBytes.length,mime:'model/gltf-binary',state:'quarantine',rights:art.rights};
 const display={id:art.primaryAssetId,object_key:job.approved_key,target_key:job.approved_key,sha256:sha256(displayBytes),bytes:displayBytes.length,mime:'model/gltf-binary',state:'approved',rights:art.rights};
 const derivative={version:1,kind:'hayes-original-display-v1',originalAssetId:originalId,displayAssetId:display.id,attemptId,
  sourceSha256:original.sha256,sourceBytes:original.bytes,outputSha256:display.sha256,outputBytes:display.bytes,
  recipe:{kind:'native-hayes-generate-validate-v1',workerManifestSha256:release.worker_manifest_sha256},receiptSha256:release.receipt_sha256};
 const grants:{asset_id:string;metadata:Record<string,unknown>}[]=[];
 const publication:{snapshot?:unknown;revision_sha256?:string}={};
 let classification=true;
 const c={query:vi.fn(async(sql:string,args:unknown[]=[]):Promise<{rows:unknown[];rowCount:number}>=>{
  let rows:unknown[]=[];
  if(sql==='SHOW transaction_isolation')rows=[{transaction_isolation:'read committed'}];
  else if(sql==='SELECT txid_current()::text AS xid')rows=[{xid:'123'}];
  else if(sql.startsWith('SELECT p.snapshot,p.revision_sha256'))rows=[publication];
  else if(sql.startsWith('SELECT 1 FROM exhibitions'))rows=[{exists:1}];
  else if(sql.startsWith('SELECT id FROM import_jobs'))rows=classification?[{id:jobId}]:[];
  else if(sql.includes('FROM hayes_native_releases r'))rows=[release];
  else if(sql.includes('SELECT a.*,r.metadata AS rights'))rows=[original,display];
  else if(sql.startsWith('SELECT metadata FROM asset_derivatives')&&sql.includes('AND id=$2'))rows=[{metadata:derivative}];
  else if(sql.startsWith("SELECT metadata->>'kind' AS kind"))rows=grants.filter(row=>row.metadata.publicationId===args[3]&&(row.metadata.candidate as {assetId?:string})?.assetId===args[4]).map(row=>({kind:row.metadata.kind}));
  else if(sql.startsWith('SELECT asset_id,metadata'))rows=grants.filter(row=>args.includes(row.metadata.kind));
  else if(sql.startsWith('INSERT INTO asset_derivatives'))grants.push({asset_id:String(args[2]),metadata:args[3] as Record<string,unknown>});
  return {rows,rowCount:rows.length};
 })} as unknown as PoolClient;
 const current={revision:art.revision,approved_revision:art.revision,approved_asset_id:art.primaryAssetId};
 const cms={ownArtwork:vi.fn(async()=>current),studioArtwork:vi.fn(async()=>({artwork:art}))} as unknown as Cms;
 const imports={nativeWorkspace:owner,coarseOwner:vi.fn(async()=>owner),access:vi.fn(async()=>job),view:vi.fn(()=>({id:jobId}))} as unknown as Imports;
 const exhibition={revision:123,metadata:draft,studio_owner_user_id:s.userId};
 const studio={access:vi.fn(async()=>exhibition)} as unknown as Studio;
 const blobs={getBounded:vi.fn(async(key:string)=>Buffer.from(key===job.object_key?originalBytes:displayBytes))} as unknown as BlobStore;
 seams.inspect.mockImplementation(async()=>({version:1,inspector:'native-adopted-embedded-glb-v1',assetSha256:original.sha256,assetBytes:original.bytes,media:{kind:'glb',glbVersion:2,sceneCount:1,nodeCount:1,primitiveCount:1,drawCount:1,triangles:1,geometryCpuBytes:36,geometryGpuBytes:36,textures:[],requiredExtensions:[],externalReferences:false},cost:{model:'native-adopted-embedded-glb-v1',residentBytes:72,peakAdditionalBytes:712}}));
 const input:FinishedHayesOriginalApproval={kind:FINISHED_HAYES_ORIGINAL_PROFILE,artworkId:art.id,artworkRevision:art.revision,importJobId:jobId,attemptId,receiptId,receiptSha256:release.receipt_sha256,completionFrameSha256:release.completion_frame_sha256};
 return {publication,s,draft,art,c,owner,cms,imports,studio,blobs,input,exhibition,current,job,release,original,display,derivative,grants,originalBytes,displayBytes,released,
  noHayes:()=>{classification=false;},discover:()=>resolveFinishedHayesCandidate(c,s,art.id,art.revision,cms,imports),
  approve:()=>approveFinishedHayesOriginal(c,s,draft.exhibitionId,input,etag(exhibition.revision,draft),studio,cms,imports,blobs),
  status:()=>readFinishedHayesOriginalApproval(c,s,draft.exhibitionId,input,studio,cms,imports,blobs)};
}
it('discovers only a classified finished source and binds release verification to the physical owner',async()=>{
 const f=setup(),found=await f.discover();expect(found?.finishedHayesCustody).toMatchObject({kind:FINISHED_HAYES_ORIGINAL_PROFILE,workspaceId:f.owner.workspaceId,artworkId:f.art.id,importJobId:f.job.id,release:{receiptId:f.input.receiptId},original:{assetId:f.original.id}});
 expect(seams.released).toHaveBeenCalledWith(f.c,f.s.tenantId,{workspaceId:f.owner.workspaceId,principalId:f.s.userId,jobId:f.job.id,completionFrameSha256:f.release.completion_frame_sha256});
 expect(f.grants).toEqual([]);expect(f.blobs.getBounded).not.toHaveBeenCalled();f.noHayes();expect(await f.discover()).toBeNull();
});
it('issues once, independently reads back, and revalidates bytes before a publication source read',async()=>{
 const f=setup();expect((await f.status()).approved).toBe(false);
 const approved=await f.approve();expect(approved.approved).toBe(true);expect(approved.etag).toBe(etag(123,f.draft));expect(approved.custody.release).toEqual({attemptId:f.input.attemptId,receiptId:f.input.receiptId,receiptSha256:f.input.receiptSha256,completionFrameSha256:f.input.completionFrameSha256});
 expect(await f.status()).toEqual(approved);expect(await f.approve()).toEqual(approved);expect(f.grants).toHaveLength(1);expect(seams.inspect).toHaveBeenCalledTimes(1);
 const read=await readApprovedFinishedHayesOriginal(f.c,f.s,f.draft.exhibitionId,f.input,f.studio,f.cms,f.imports,f.blobs,new AbortController().signal);
 expect(read.bytes).toEqual(f.originalBytes);read.bytes.fill(0);
});
it.each(['release','canonical','match','derivative','source-state','display-state','rights','head','receipt','owner'] as const)('refuses %s evidence without issuing a grant or falling through',async problem=>{
 const f=setup();
 switch(problem){
  case 'release':seams.released.mockResolvedValue(new Set());break;
  case 'canonical':seams.parse.mockImplementation(()=>{throw Error('invalid');});break;
  case 'match':seams.match.mockImplementation(()=>{throw Error('mismatch');});break;
  case 'derivative':f.derivative.sourceBytes++;break;
  case 'source-state':f.original.state='approved';break;
  case 'display-state':f.display.state='quarantine';break;
  case 'rights':f.art.rights.permissions.download=false;break;
  case 'head':f.exhibition.metadata=structuredClone(f.draft);f.exhibition.metadata.candidate.artworks=[];break;
  case 'receipt':f.input.receiptSha256='0'.repeat(64);break;
  case 'owner':seams.issued.mockReturnValue(false);break;
 }
 await expect(f.approve()).rejects.toThrow();expect(f.grants).toEqual([]);
});
it('rejects caller source claims, stale head and corrupt body bytes',async()=>{
 const f=setup();
 await expect(approveFinishedHayesOriginal(f.c,f.s,f.draft.exhibitionId,{...f.input,sourceSha256:f.original.sha256} as typeof f.input,'ignored',f.studio,f.cms,f.imports,f.blobs)).rejects.toMatchObject({code:'INVALID_INPUT'});
 await expect(approveFinishedHayesOriginal(f.c,f.s,f.draft.exhibitionId,f.input,etag(122,f.draft),f.studio,f.cms,f.imports,f.blobs)).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
 vi.mocked(f.blobs.getBounded!).mockResolvedValueOnce(Buffer.alloc(f.originalBytes.length,3));await expect(f.approve()).rejects.toMatchObject({code:'FINISHED_HAYES_ORIGINAL_UNAVAILABLE'});
 expect(f.grants).toEqual([]);
});
it('does not manufacture a grant when inspection fails and refuses a changed grant on readback',async()=>{
 const f=setup();seams.inspect.mockRejectedValueOnce(Error('NATIVE_MODEL_DETAIL_UNSUPPORTED'));
 await expect(f.approve()).rejects.toThrow('NATIVE_MODEL_DETAIL_UNSUPPORTED');expect(f.grants).toEqual([]);
 await f.approve();f.grants[0]!.metadata.release={...f.input,receiptSha256:'0'.repeat(64)};
 await expect(f.status()).rejects.toMatchObject({code:'FINISHED_HAYES_ORIGINAL_UNAVAILABLE'});
});

it('binds an explicit release grant to fresh public IDs and revalidates authority on bytes and final rereads',async()=>{
 const f=setup();await f.approve();
 const scope={workspaceId:f.owner.workspaceId,exhibitionId:f.draft.exhibitionId,publicationId:randomUUID()};
 const publicArt=structuredClone(f.art);publicArt.id=randomUUID();publicArt.revisionId=randomUUID();
 const identities=[{artworkId:f.art.id,artworkRevisionId:f.art.revisionId,artworkRevision:f.art.revision,publicArtworkId:publicArt.id,publicArtworkRevisionId:publicArt.revisionId}];
 const deps={studio:f.studio,cms:f.cms,imports:f.imports,blobs:f.blobs},signal=new AbortController().signal;
 const items=await prepareRequiredModelOriginals(f.c,f.s,scope,[publicArt],identities,new Set(),deps,signal);
 expect(items).toHaveLength(1);const item=items[0]!,revision='9'.repeat(64);
 expect(item.candidate.assetId).not.toBe(f.original.id);expect(item.candidate.assetId).not.toBe(f.display.id);
 expect(item.candidate.featureReport.inspector).toBe('native-adopted-embedded-glb-v1');
 expect(item.candidate.sourceBindingSha256).toMatch(/^[a-f0-9]{64}$/);
 await persistRequiredModelOriginal(f.c,f.s,scope,revision,item,deps,signal);
 expect(f.grants.map(row=>row.metadata.kind)).toEqual(['finished-hayes-original-static-grant','native-finished-hayes-detail-binding']);
 const read=()=>readBoundModelOriginal(f.c,f.s,scope,revision,publicArt.id,publicArt.revisionId,item.candidate,deps,signal);
 for(let i=0;i<2;i++){const bytes=await read();expect(bytes).toEqual(f.originalBytes);bytes.fill(0);}
 await expect(readBoundModelOriginal(f.c,f.s,scope,'0'.repeat(64),publicArt.id,publicArt.revisionId,item.candidate,deps,signal)).rejects.toMatchObject({code:'NATIVE_DETAIL_UNAVAILABLE'});
 // Both export and final validation must consult current release/rights/bytes.
 f.released.clear();await expect(read()).rejects.toMatchObject({code:'FINISHED_HAYES_ORIGINAL_UNAVAILABLE'});
 f.released.add(`import_jobs:${f.s.tenantId}:${f.job.id}`);f.released.add(`hayes_output_stages:${f.s.tenantId}:${f.release.stage_id}`);
 vi.mocked(f.blobs.getBounded!).mockResolvedValueOnce(Buffer.alloc(f.originalBytes.length,3));await expect(read()).rejects.toMatchObject({code:'FINISHED_HAYES_ORIGINAL_UNAVAILABLE'});
 f.grants.push(structuredClone(f.grants[1]!));await expect(read()).rejects.toMatchObject({code:'NATIVE_DETAIL_UNAVAILABLE'});
});

it('runs the existing publication prepare/persist/recheck and final verification with the Hayes source adapter',async()=>{
 const f=setup();await f.approve();
 const publicArt=structuredClone(f.art);publicArt.id=randomUUID();publicArt.revisionId=randomUUID();
 const snapshot=structuredClone(f.draft.candidate);snapshot.artworks=[publicArt];
 const identities=[{artworkId:f.art.id,artworkRevisionId:f.art.revisionId,artworkRevision:f.art.revision,publicArtworkId:publicArt.id,publicArtworkRevisionId:publicArt.revisionId}];
 // File-store identity is real; body retrieval and bootstrap branding are isolated
 // seams. No Native live profile or database is opened by this synthetic test.
 const blobs=new FileBlobStore('/synthetic-unused');vi.spyOn(blobs,'getBounded').mockImplementation(async(...args)=>Buffer.from(await f.blobs.getBounded!(...args)));
 const context={owner:f.owner,runtimeGeneration:randomUUID(),signal:new AbortController().signal,live:()=>true};
 const producer=createNativeOriginalPublication({context:context as never,studio:f.studio,cms:f.cms,imports:f.imports,blobs});
 const publicationId=randomUUID(),prepared=await producer.prepare(f.c,f.s,f.draft.exhibitionId,publicationId,snapshot,identities,[]);
 expect(prepared.requiredModels).toHaveLength(1);expect(prepared.items).toHaveLength(0);expect(prepared.models).toHaveLength(0);
 const revision=revisionHash(prepared.snapshot);f.publication.snapshot=structuredClone(prepared.snapshot);f.publication.revision_sha256=revision;
 await producer.persist(f.c,f.s,prepared,revision);await producer.recheck(f.c,f.s,prepared,revision);
 await producer.verifyExisting(f.c,f.s,f.draft.exhibitionId,publicationId,revision,prepared.snapshot);
 expect(f.grants).toHaveLength(2);expect(f.grants[1]!.metadata).toMatchObject({kind:'native-finished-hayes-detail-binding',publicationId,revisionSha256:revision});
 f.art.rights.permissions.export=false;
 await expect(producer.recheck(f.c,f.s,prepared,revision)).rejects.toMatchObject({code:'ORIGINAL_STATIC_RIGHTS_DENIED'});
 await expect(producer.verifyExisting(f.c,f.s,f.draft.exhibitionId,publicationId,revision,prepared.snapshot)).rejects.toMatchObject({code:'ORIGINAL_STATIC_RIGHTS_DENIED'});
});
