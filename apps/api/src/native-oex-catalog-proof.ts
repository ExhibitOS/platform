// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {transaction} from '@exhibitos/storage';
import {publicationDiskOwner} from './publication-attempt.ts';
import type {DiskOwner} from './publication-disk-budget.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

type Channel={isOpen():boolean;send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
const used=new WeakSet<object>(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,hex=/^[a-f0-9]{64}$/;
/** Versioned selected 027 channel exchange. Manager must independently query
 * its owned PG and inspect its pinned store before ACK; the ACK alone is not
 * proof of that implementation. The caller retains Session/root ownership. */
export async function sendNativeOexCatalogProof(input:{pool:Pool;channel:Channel;context:NativeOexWorkspaceContext;runtimeGeneration:string;payloadManifestSha256:string;owner:DiskOwner;verifyLive:()=>Promise<void>;signal:AbortSignal}){
 const {pool,channel,context,runtimeGeneration,payloadManifestSha256,verifyLive,signal}=input,owner=structuredClone(input.owner);
 if(!pool||!channel||typeof channel.isOpen!=='function'||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||used.has(channel)||!context||![context.workspaceId,context.tenantId,context.principalId,runtimeGeneration].every(v=>typeof v==='string'&&uuid.test(v))||!hex.test(payloadManifestSha256)||typeof verifyLive!=='function'||!signal)throw Error('NATIVE_OEX_CATALOG_PROOF');used.add(channel);
 const workspaceImport=context.workspaceImport===true,wallImport=context.workspaceWallImport===true;
 if(wallImport&&!workspaceImport)throw Error('NATIVE_OEX_CATALOG_PROOF');
 const live=async()=>{signal.throwIfAborted();if(!channel.isOpen())throw Error('NATIVE_OEX_CATALOG_PROOF');await verifyLive();signal.throwIfAborted();};
 const check=async()=>transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await context.assertDatabase(c);if(workspaceImport){context.assertOwner!(owner);await context.assertImportCatalog!(c);}if(!isDeepStrictEqual(await publicationDiskOwner(c,owner.storeRoot),owner))throw Error('NATIVE_OEX_CATALOG_PROOF');});
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  if(workspaceImport&&(!context.workspaceMaterials||typeof context.assertImportCatalog!=='function'||typeof context.assertOwner!=='function'))throw Error('NATIVE_OEX_CATALOG_PROOF');
  await live();await check();await live();const workspace=context.workspaceMaterials===true;const frame={version:wallImport?7:workspaceImport?6:workspace?5:2,kind:wallImport?'catalog-ready-v7':workspaceImport?'catalog-ready-v6':workspace?'catalog-ready-v5':'catalog-ready-v2',protocol:wallImport?'normal-oex-workspace-import-v7':workspaceImport?'normal-oex-workspace-import-v6':workspace?'normal-oex-workspace-v5':'normal-oex-027-v2',correlationId:randomUUID(),workspaceId:context.workspaceId,tenantId:context.tenantId,principalId:context.principalId,runtimeGeneration,payloadManifestSha256,databaseSystemId:owner.databaseSystemId,databaseOid:owner.databaseOid,storeDevice:owner.storeDevice,storeInode:owner.storeInode,schema026Sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112',schema027Sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7',...(workspace?{schema028Sha256:'1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af',schema029Sha256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a',schema030Sha256:'8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848',schema031Sha256:'2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5',schema032Sha256:'bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc'}:{}),...(workspaceImport?{schema033Sha256:'f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd',schema034Sha256:'ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'}:{}),...(wallImport?{schema035Sha256:'c347183b3e58805c46d1dde7ae6e2defc37762af52f585846357181b9635a544'}:{})};
  await channel.send(Buffer.from(JSON.stringify(frame)));const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('NATIVE_OEX_CATALOG_PROOF');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  if(text!==JSON.stringify({...frame,kind:wallImport?'catalog-ack-v7':workspaceImport?'catalog-ack-v6':workspace?'catalog-ack-v5':'catalog-ack-v2'}))throw Error('NATIVE_OEX_CATALOG_PROOF');await live();await check();await live();return Object.freeze(frame);
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}
