// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,open,realpath,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Artwork} from '@exhibitos/spec';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {DISPLAY_POLICY_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {nativeModelAdoptionRightsPolicyDigest,type NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';
import {commitNativeModelAdoptionTarget,lockNativeModelAdoptionTarget} from './native-model-adoption-target.ts';
import {etag,type Studio} from './studio.ts';
import {replaceArtworkReferences} from './artwork-snapshot-replacement.ts';

const approvals=vi.hoisted(()=>[] as Record<string,unknown>[]);
vi.mock('./approved-demo-display-files.ts',()=>({APPROVED_DEMO_DISPLAY_FILES:approvals}));

it.each([false,true])('binds adoption to the exact current owner, rights and placement without requiring a preexisting original hash (protected=%s)',async(protectedPolicy)=>{
 const s={tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session;
 const rights={holder:'Synthetic Institution',ownership:'owner' as const,licenseId:'CC0-1.0',
  permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic credit'};
 const prior={...syntheticArtwork('sculpture'),rights};
 approvals.length=0;
 const oldPolicy={version:1,profile:'approved-open-access-demo-v1',approvalId:'11111111-1111-4111-8111-111111111111',sourceAssetSha256:prior.assets[0]!.sha256,rightsEvidenceSha256:'d'.repeat(64)};
 const selected={institutionRecordId:'synthetic-work',canonicalMime:'model/gltf-binary',canonicalRole:'model',artworkType:'sculpture',canonicalTriangles:2,canonicalMaxTextureSize:512,allowedPublicUses:{staticAssets:true,OEXIncludingAsset:true}};
 const successor={...selected,approvalId:'22222222-2222-4222-8222-222222222222',canonicalAssetSha256:'c'.repeat(64),canonicalBytes:32,rawSourceSha256:'b'.repeat(64),rightsEvidenceSha256:'e'.repeat(64)};
 if(protectedPolicy){
  prior.extensions={...prior.extensions,[DISPLAY_POLICY_NAMESPACE]:oldPolicy};
  approvals.push({...selected,approvalId:oldPolicy.approvalId,canonicalAssetSha256:prior.assets[0]!.sha256,canonicalBytes:prior.assets[0]!.bytes,rightsEvidenceSha256:oldPolicy.rightsEvidenceSha256},successor);
 }
 const draft=newDraft(),placementId=randomUUID(),workspaceId=randomUUID();
 const placement={id:placementId,artworkRevisionId:prior.revisionId,assetId:prior.primaryAssetId};
 Object.assign(draft.candidate,{artworks:[prior],placements:[placement]});
 const row={revision:prior.revision,approved_revision:prior.revision,metadata:{
  title:'Synthetic model',description:'',dimensions:{width:1,height:1,unit:'m'},rights,
  provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:''},
 }};
 const studioAccess=vi.fn(async()=>({revision:1,metadata:draft,studio_owner_user_id:s.userId}));
 const ownArtwork=vi.fn(async()=>row);
 const studio={access:studioAccess} as unknown as Studio;
 const cms={ownArtwork,studioArtwork:vi.fn(async()=>({artwork:prior}))} as unknown as Cms;
 const coarseOwner=vi.fn(),imports={requiredModelReady:vi.fn(),coarseOwner} as unknown as Imports;
 const c={} as PoolClient,now=Date.now();
 const sourceRights={...rights,creditLine:'Independent source attribution',
  licenseText:'Synthetic public-domain dedication for the 3D media. https://creativecommons.org/publicdomain/zero/1.0/'};
 const grant:NativeModelAdoptionGrant={version:1,operationId:randomUUID(),issuedAt:now,expiresAt:now+10_000,
  source:{workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),artworkId:randomUUID(),artworkRevision:1,artworkRevisionId:randomUUID()},
  target:{workspaceId,tenantId:s.tenantId,principalId:s.userId,artworkId:prior.id,artworkRevision:prior.revision,
   exhibitionId:draft.exhibitionId,placementId,etag:etag(1,draft)},
  receiptSha256:'a'.repeat(64),rightsSha256:modelReceiptDigest(sourceRights),
  rightsPolicySha256:nativeModelAdoptionRightsPolicyDigest(sourceRights),sourceCreditLine:sourceRights.creditLine,
  original:{sha256:'b'.repeat(64),bytes:64},display:{sha256:'c'.repeat(64),bytes:32},
 };
 const run=(input=grant,session=s)=>lockNativeModelAdoptionTarget(c,session,input,studio,cms,imports);
 await expect(run(grant,{...s,userId:randomUUID()})).rejects.toThrow('FORBIDDEN');
 expect(studioAccess).not.toHaveBeenCalled();
 await expect(run({...grant,target:{...grant.target,etag:etag(2,draft)}})).rejects.toThrow('REMOTE_CONFLICT');
 expect(ownArtwork).not.toHaveBeenCalled();
 await expect(run({...grant,rightsPolicySha256:nativeModelAdoptionRightsPolicyDigest({...rights,permissions:{...rights.permissions,export:false}})})).rejects.toThrow('RIGHTS_DENIED');
 await expect(run({...grant,rightsPolicySha256:nativeModelAdoptionRightsPolicyDigest({
  ...sourceRights,licenseText:sourceRights.licenseText+' Additional approval is required.',
 })})).rejects.toThrow('RIGHTS_DENIED');
 await expect(run({...grant,target:{...grant.target,placementId:randomUUID()}})).rejects.toThrow('MODEL_ADOPTION_TARGET_CHANGED');
 expect(prior.assets.some(asset=>asset.sha256===grant.original.sha256)).toBe(false);
 await expect(run()).resolves.toEqual({grant,artwork:row,prior,candidate:draft.candidate});
 expect(coarseOwner).toHaveBeenCalledWith(c,s.tenantId,s.userId,workspaceId);

 const response={revision:2,etag:etag(2,draft),draft};
 const query=vi.fn(async(sql:string)=>sql.includes('FROM studio_requests')?{
  rowCount:1,rows:[{payload_sha256:modelReceiptDigest(['native-model-adoption-v1',modelReceiptDigest(grant)]),exhibition_id:draft.exhibitionId,response}],
 }:{rowCount:0,rows:[]});
 const putDurable=vi.fn();
 const input={client:{query} as unknown as PoolClient,session:s,grant,
  confirmedGrantSha256:modelReceiptDigest(grant),broker:{} as never,
  blobs:{putDurable} as unknown as BlobStore,cms,imports,studio,
  signal:new AbortController().signal,assertLive:async()=>{},
 };
 await expect(commitNativeModelAdoptionTarget({...input,confirmedGrantSha256:'a'.repeat(64)})).rejects.toThrow('FORBIDDEN');
 expect(query).not.toHaveBeenCalled();
 await expect(commitNativeModelAdoptionTarget(input)).resolves.toEqual(response);
 expect(putDurable).not.toHaveBeenCalled();
 const different={...grant,receiptSha256:'e'.repeat(64)};
 await expect(commitNativeModelAdoptionTarget({...input,grant:different,confirmedGrantSha256:modelReceiptDigest(different)})).rejects.toThrow('REQUEST_CONFLICT');
 expect(putDurable).not.toHaveBeenCalled();

 const {publicTexturedGLB,publicTexturePNG}=createRequire(import.meta.url)('../../../scripts/embedded-texture-fixture.mjs') as {
  publicTexturedGLB:(options?:{png:Buffer})=>Buffer;publicTexturePNG:(width:number,height:number)=>Buffer;
 };
 const original=publicTexturedGLB({png:publicTexturePNG(64,64)}),display=publicTexturedGLB();
 const identity=(bytes:Buffer)=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const accepted={...grant,original:identity(original),display:identity(display)};
 if(protectedPolicy){
  await expect(run(accepted)).rejects.toThrow('MODEL_ADOPTION_TARGET_CHANGED');
  Object.assign(successor,{canonicalAssetSha256:accepted.display.sha256,canonicalBytes:accepted.display.bytes,rawSourceSha256:accepted.original.sha256});
 }
 await expect(run(accepted)).resolves.toMatchObject({grant:accepted});
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-adoption-target-'))),handle=await open(root,'r');
 try{
  const helper=join(root,'broker.cjs'),stat=await handle.stat({bigint:true});
  await writeFile(helper,`#!${process.execPath}
const fs=require('node:fs'),request=JSON.parse(fs.readFileSync(0,'utf8'));
if(process.argv[2]!=='--model-adoption-stage-read-v1'||!['original','display'].includes(request.role))process.exit(2);
const encoded=request.role==='original'?${JSON.stringify(original.toString('base64'))}:${JSON.stringify(display.toString('base64'))};
process.stdout.write(Buffer.from(encoded,'base64'));
`,{mode:0o700});
  let approved:Artwork|undefined,recorded=false;
  const commitQuery=vi.fn(async(sql:string,params:unknown[])=>{
   if(sql.startsWith('INSERT INTO artwork_approvals'))approved=(params[4] as {importedArtwork:Artwork}).importedArtwork;
   if(sql.startsWith('INSERT INTO studio_requests'))recorded=true;
   return {rows:[],rowCount:sql.startsWith('UPDATE artworks')?1:0};
  });
  const verifyStudio={...studio,putArtworkReplacement:vi.fn<Studio['putArtworkReplacement']>(async(_c,_s,_id,old,next,_request,_etag,placementId,mode)=>{
   const candidate=replaceArtworkReferences(draft.candidate,old,next,placementId,mode);
   return {...response,draft:{...draft,candidate} as typeof draft};
  })} as unknown as Studio;
  const verifyCms={...cms,studioArtwork:vi.fn(async()=>({artwork:approved??prior}))} as unknown as Cms;
  const saved=new Map<string,Buffer>();
  const result=await commitNativeModelAdoptionTarget({...input,client:{query:commitQuery} as unknown as PoolClient,
   grant:accepted,confirmedGrantSha256:modelReceiptDigest(accepted),cms:verifyCms,studio:verifyStudio,
   blobs:{putDurable:async(key:string,bytes:Buffer)=>{saved.set(key,Buffer.from(bytes));},
    getBounded:async(key:string)=>saved.get(key)!} as unknown as BlobStore,
   broker:{helper,rootFd:handle.fd,rootDevice:String(stat.dev),rootInode:String(stat.ino)},
  });
  expect(recorded).toBe(true);
  expect(approved).toMatchObject({id:prior.id,revision:prior.revision+1,rights,transform:prior.transform,assets:[accepted.display]});
  expect(result.draft.candidate.placements[0]).toMatchObject({id:placementId,artworkRevisionId:approved!.revisionId,assetId:approved!.primaryAssetId});
  expect([...saved.values()]).toEqual([display,original]);
  if(protectedPolicy){
   expect(approved!.extensions![DISPLAY_POLICY_NAMESPACE]).toMatchObject({approvalId:successor.approvalId,sourceAssetSha256:accepted.display.sha256,rightsEvidenceSha256:successor.rightsEvidenceSha256});
   expect(prior.extensions![DISPLAY_POLICY_NAMESPACE]).toEqual(oldPolicy);
  }
  const custody=commitQuery.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO asset_derivatives'))![1][3] as {priorDisplayPolicy:unknown};
  expect(custody.priorDisplayPolicy).toEqual(protectedPolicy?oldPolicy:null);
 }finally{await handle.close();await rm(root,{recursive:true,force:true});}

});

it('changes only the saved model binding for the selected same-artwork revision',()=>{
 const prior=syntheticArtwork('sculpture'),next=structuredClone(prior);
 const placement={id:randomUUID(),artworkRevisionId:prior.revisionId,assetId:prior.primaryAssetId,position:[2,0,3]};
 const candidate=newDraft().candidate;
 Object.assign(candidate,{artworks:[prior],placements:[placement]});
 next.revision++;
 next.revisionId=randomUUID();
 next.primaryAssetId=randomUUID();
 next.assets=[{...prior.assets[0]!,id:next.primaryAssetId}];
 const changed=replaceArtworkReferences(candidate,prior,next,placement.id,'same-artwork-model');
 expect(changed.placements[0]).toEqual({...placement,assetId:next.primaryAssetId,artworkRevisionId:next.revisionId});
 expect(changed.artworks[0]!.id).toBe(prior.id);
 expect(candidate.placements[0]).toEqual(placement);
 expect(()=>replaceArtworkReferences(candidate,prior,next,placement.id)).toThrow('ARTWORK_REPLACEMENT_INVALID');
 expect(()=>replaceArtworkReferences(candidate,prior,{...next,dimensions:{width:10,height:10,depth:10}},placement.id,'same-artwork-model')).toThrow('ARTWORK_REPLACEMENT_INVALID');
});
