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
 const live=async()=>{signal.throwIfAborted();if(!channel.isOpen())throw Error('NATIVE_OEX_CATALOG_PROOF');await verifyLive();signal.throwIfAborted();};
 const check=async()=>transaction(pool,async c=>{await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','10000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await context.assertDatabase(c);if(!isDeepStrictEqual(await publicationDiskOwner(c,owner.storeRoot),owner))throw Error('NATIVE_OEX_CATALOG_PROOF');});
 const abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  await live();await check();await live();const frame={version:2,kind:'catalog-ready-v2',protocol:'normal-oex-027-v2',correlationId:randomUUID(),workspaceId:context.workspaceId,tenantId:context.tenantId,principalId:context.principalId,runtimeGeneration,payloadManifestSha256,databaseSystemId:owner.databaseSystemId,databaseOid:owner.databaseOid,storeDevice:owner.storeDevice,storeInode:owner.storeInode,schema026Sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112',schema027Sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'};
  await channel.send(Buffer.from(JSON.stringify(frame)));const raw=await channel.receive(120000);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('NATIVE_OEX_CATALOG_PROOF');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  if(text!==JSON.stringify({...frame,kind:'catalog-ack-v2'}))throw Error('NATIVE_OEX_CATALOG_PROOF');await live();await check();await live();return Object.freeze(frame);
 }catch(error){await channel.close().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);}
}
