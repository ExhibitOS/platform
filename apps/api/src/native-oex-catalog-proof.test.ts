// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {sendNativeOexCatalogProof} from './native-oex-catalog-proof.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
vi.mock('./publication-attempt.ts',()=>({publicationDiskOwner:vi.fn(async()=>({databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'}))}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it.each(['exact','oid','duplicate','extra'])('sends v2 only after exact context check; ACK case: %s',async variant=>{
 const query=vi.fn(async()=>({rows:[],rowCount:0})),client={query,release:vi.fn()} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool;
 const assertDatabase=vi.fn(async()=>{}),context:NativeOexWorkspaceContext={workspaceId:id(1),tenantId:id(2),principalId:id(3),assertCatalog:async()=>{},assertDatabase,assertRecord:async()=>{}};
 let sent:Record<string,unknown>={},closed=false;const channel={isOpen:()=>!closed,send:async(raw:Uint8Array)=>{sent=JSON.parse(Buffer.from(raw).toString());},receive:async()=>{const encoded=JSON.stringify({...sent,kind:'catalog-ack-v2',...(variant==='oid'?{databaseOid:'999'}:{}),...(variant==='extra'?{extra:true}:{})});return Buffer.from(variant==='duplicate'?encoded.slice(0,-1)+',"version":2}':encoded);},close:async()=>{closed=true;}};
 const value=sendNativeOexCatalogProof({pool,channel,context,runtimeGeneration:id(4),payloadManifestSha256:'a'.repeat(64),owner:{databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'},verifyLive:async()=>{},signal:new AbortController().signal});
 if(variant!=='exact'){await expect(value).rejects.toThrow('NATIVE_OEX_CATALOG_PROOF');expect(closed).toBe(true);expect(assertDatabase).toHaveBeenCalledTimes(1);}
 else {await expect(value).resolves.toMatchObject({version:2,kind:'catalog-ready-v2',protocol:'normal-oex-027-v2',workspaceId:id(1),databaseSystemId:'42',schema027Sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'});expect(assertDatabase).toHaveBeenCalledTimes(2);expect(closed).toBe(false);await expect(sendNativeOexCatalogProof({pool,channel,context,runtimeGeneration:id(4),payloadManifestSha256:'a'.repeat(64),owner:{databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'},verifyLive:async()=>{},signal:new AbortController().signal})).rejects.toThrow('NATIVE_OEX_CATALOG_PROOF');}
});


it.each(['exact','changed031','old-ack'])('binds the full v5 ledger to owner acknowledgement: %s',async variant=>{
 const client={query:async()=>({rows:[],rowCount:0}),release:()=>{}} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool;
 const context:NativeOexWorkspaceContext={workspaceId:id(1),tenantId:id(2),principalId:id(3),workspaceMaterials:true,assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}};
 let sent:Record<string,unknown>={},closed=false;const channel={isOpen:()=>!closed,send:async(raw:Uint8Array)=>{sent=JSON.parse(Buffer.from(raw).toString());},receive:async()=>Buffer.from(JSON.stringify({...sent,kind:variant==='old-ack'?'catalog-ack-v2':'catalog-ack-v5',...(variant==='changed031'?{schema031Sha256:'0'.repeat(64)}:{})})),close:async()=>{closed=true;}};
 const promise=sendNativeOexCatalogProof({pool,channel,context,runtimeGeneration:id(4),payloadManifestSha256:'a'.repeat(64),owner:{databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'},verifyLive:async()=>{},signal:new AbortController().signal});
 if(variant==='exact')await expect(promise).resolves.toMatchObject({version:5,kind:'catalog-ready-v5',protocol:'normal-oex-workspace-v5',schema031Sha256:'2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5',schema032Sha256:'bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc'});
 else{await expect(promise).rejects.toThrow('NATIVE_OEX_CATALOG_PROOF');expect(closed).toBe(true);}
});

it.each(['exact','old-ack','wrong-ledger','extra','unqualified'])('requires exact v6 owner and import catalog before and after ACK: %s',async variant=>{
 const client={query:async()=>({rows:[],rowCount:0}),release:()=>{}} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool,assertImportCatalog=vi.fn(async()=>{});
 const context:NativeOexWorkspaceContext={workspaceId:id(1),tenantId:id(2),principalId:id(3),workspaceMaterials:variant!=='unqualified',workspaceImport:true,assertImportCatalog,assertOwner:()=>{},assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}};
 let sent:Record<string,unknown>={},closed=false;const channel={isOpen:()=>!closed,send:async(raw:Uint8Array)=>{sent=JSON.parse(Buffer.from(raw).toString());},receive:async()=>Buffer.from(JSON.stringify({...sent,kind:variant==='old-ack'?'catalog-ack-v5':'catalog-ack-v6',...(variant==='wrong-ledger'?{schema034Sha256:'0'.repeat(64)}:{}),...(variant==='extra'?{extra:true}:{})})),close:async()=>{closed=true;}};
 const promise=sendNativeOexCatalogProof({pool,channel,context,runtimeGeneration:id(4),payloadManifestSha256:'a'.repeat(64),owner:{databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'},verifyLive:async()=>{},signal:new AbortController().signal});
 if(variant==='exact'){await expect(promise).resolves.toMatchObject({version:6,kind:'catalog-ready-v6',protocol:'normal-oex-workspace-import-v6',schema033Sha256:'f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd',schema034Sha256:'ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'});expect(assertImportCatalog).toHaveBeenCalledTimes(2);expect(Object.keys(sent)).toEqual(['version','kind','protocol','correlationId','workspaceId','tenantId','principalId','runtimeGeneration','payloadManifestSha256','databaseSystemId','databaseOid','storeDevice','storeInode','schema026Sha256','schema027Sha256','schema028Sha256','schema029Sha256','schema030Sha256','schema031Sha256','schema032Sha256','schema033Sha256','schema034Sha256']);}
 else await expect(promise).rejects.toThrow('NATIVE_OEX_CATALOG_PROOF');
});
