// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
const state=vi.hoisted(()=>({revision:1,reference:undefined as unknown,rights:undefined as unknown}));
vi.mock('@exhibitos/storage',async original=>({...await original<typeof import('@exhibitos/storage')>(),artworkAccess:async()=>({revision:state.revision,metadata:{rights:state.rights,displayReference:state.reference}})}));
import {Imports} from './imports.ts';
it('replays a same-owner intent after revision changes and rejects changed-key use',async()=>{
 const tenant='10000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000002',workspace='10000000-0000-4000-8000-000000000003';
 const rights={holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:false}};state.rights=rights;state.revision=1;state.reference=undefined;
 const recipe={version:1 as const,role:'baseColor' as const,sampling:'nearest-centre' as const,colourMeaning:'srgb' as const,recipeSha256:'5206824d01e36782dbdd9dc9d0872f64c5e17990000495e511bc80d11bb979fd',settingsSha256:'75e2dd0126e0aca3402cbaf0bc25f40f4cdd221167704b5280293941749ffd01',sourcePixelsSha256:'4fa6dc5b4449180ba079e33b27ad378a247a215f24463752463bf9e396e14d47',outputPixelsSha256:'c62b9a101bfe04652d52df6dcc9bed65f1235e280f531ed16bb5d935f62e842a',toolVersion:'ExhibitOSManager.ImageIO/2/macOS-27.2.0',colourConversion:{version:1 as const,algorithm:'icc-to-srgb-jpeg-rgb8-v1' as const,sourceIccSha256:'f6bd2776ef85c5a0a9313989eb60f3db7996bc4af48453353f53840643d8e32b'}};
 const request={artworkId:'artwork',idempotencyKey:'same-request',mime:'image/jpeg' as const,sha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',bytes:8291194,scaleMeters:1,rights,derived:{mime:'image/png' as const,bytes:8103573,sha256:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',recipe},coarsePreparation:{version:1 as const,profile:'viewer-png-box-512-v1' as const,approvalId:'ce328328-97fa-56cf-8fc1-6bafd4573153',artworkRevision:1}};
 let stored:Record<string,unknown>|undefined;const c={query:async(sql:string,p:unknown[]=[])=>{if(sql.startsWith('SELECT * FROM import_jobs'))return {rowCount:stored?1:0,rows:stored?[stored]:[]};if(sql.startsWith('INSERT INTO import_jobs')){stored={id:p[1],tenant_id:tenant,user_id:user,mime:p[6],expected_hash:p[7],request_hash:p[5],derived:p[13],model_derivation:null,png_drain_version:1,png_worker_tokens:[],state:'uploading'};return {rowCount:1,rows:[stored]};}return {rowCount:0,rows:[]};}} as unknown as PoolClient;
 const native={workspaceId:workspace,tenantId:tenant,principalId:user,assertDatabase:async()=>{}} as unknown as NativeOexWorkspaceContext,imports=new Imports({} as Pool,{} as BlobStore,native),session={tenantId:tenant,userId:user,role:'admin'} as Session;
 const first=await imports.create(c,session,request);state.revision=2;state.reference={assetSha256:'changed'};expect(await imports.create(c,session,structuredClone(request))).toEqual(first);
 const changed=structuredClone(request);changed.coarsePreparation.artworkRevision=2;await expect(imports.create(c,session,changed)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
