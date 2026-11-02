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
