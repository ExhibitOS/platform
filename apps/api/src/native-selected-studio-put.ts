// SPDX-License-Identifier: AGPL-3.0-or-later
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {PoolClient} from 'pg';
import {traceNativeOexSelected} from './native-oex-diagnostic.ts';
import {isDeepStrictEqual} from 'node:util';
import {transaction} from '@exhibitos/storage';
import {Auth,ApiError,config,uuid,type AuthConfig,type Session} from './auth.ts';
import {Studio,requiredMatch,type StudioResponse,type StudioInput} from './studio.ts';

export interface SelectedStudioClaim {
 sessionId:string;tenantId:string;principalId:string;workspaceId:string;runtimeGeneration:string;
 jobId:string;attemptId:string;generation:string;stageId:string;reservationId:string;reservationGeneration:string;
 exhibitionId:string;requestId:string;
}
/** Future private native continuation only. These methods must retain the same
 * live Manager Session, actual committed import claim and workspace writer
 * fence, through each WHOLE callback. Do not retain global 82003/82002 locks
 * between HTTP requests. This interface is not an authority issuer or proof. */
export interface SelectedStudioOwner {
 assertCommittedImport(claim:Readonly<SelectedStudioClaim>):Promise<void>;
 /** Verify THIS transaction client's DB system/OID and pinned blob root
  * against the actual claim.owner; duplicated IDs in another DB are invalid. */
 assertDatabase(c:PoolClient):Promise<void>;
 assertLive():Promise<void>;
 runScoped<T>(work:()=>Promise<T>):Promise<T>;
}
declare const brand:unique symbol;
export interface SelectedStudioPutSlot {readonly [brand]:true}
interface Armed {claim:Readonly<SelectedStudioClaim>;owner:SelectedStudioOwner;etag:string;body:StudioInput}
interface Entry {attempted:boolean;closed:boolean;used:boolean;arming:boolean;active?:FastifyRequest;armed?:Armed;binding?:{auth:Auth;studio:Studio;settings:ReturnType<typeof config>};completion:Promise<Readonly<StudioResponse>>;resolve:(value:Readonly<StudioResponse>)=>void;reject:(error:Error)=>void;settled:boolean}
const slots=new WeakMap<SelectedStudioPutSlot,Entry>();
const entries=new WeakMap<FastifyRequest,Admission>();
interface Admission {slot:Entry;armed:Armed;failed:boolean;released:boolean;cancelled:boolean;bodySettled:boolean;payload?:import('node:stream').Readable;body?:Promise<void>;bodyDone?:()=>void;cancelIncoming:()=>void;admitting?:Promise<void>;scoped?:Promise<unknown>;actual?:Promise<unknown>;detach:()=>void}
const state=(slot:SelectedStudioPutSlot)=>{const entry=slots.get(slot);if(!entry)throw Error('NATIVE_STUDIO_SLOT');return entry;};
export function createSelectedStudioPutSlot():SelectedStudioPutSlot{
 const slot=Object.freeze(Object.create(null)) as SelectedStudioPutSlot;let resolve!:Entry['resolve'],reject!:Entry['reject'];const completion=new Promise<Readonly<StudioResponse>>((yes,no)=>{resolve=yes;reject=no;});void completion.catch(()=>{});
 slots.set(slot,{attempted:false,closed:false,used:false,arming:false,completion,resolve,reject,settled:false});return slot;
}
function finish(entry:Entry,result?:StudioResponse){if(entry.settled)return;entry.settled=true;if(result){try{const frozen=structuredClone(result);const freeze=(v:unknown):void=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};freeze(frozen);entry.resolve(frozen);}catch{entry.reject(new ApiError(409,'NATIVE_STUDIO_CLOSED'));}}else entry.reject(new ApiError(409,'NATIVE_STUDIO_CLOSED'));}
export function closeSelectedStudioPutSlot(slot:SelectedStudioPutSlot):void{
 const entry=state(slot);entry.closed=true;
 if(entry.active){entries.get(entry.active)?.cancelIncoming();void fail(entry.active);}else if(!entry.arming)finish(entry);
}
/** Private finally: close this admission and wait for parser terminal and
 * already-started owner/GET/PUT/COMMIT work. Settlement is not success or
 * authority to clean up a claim. Never destroy a DB client or server. */
export async function drainSelectedStudioPutSlot(slot:SelectedStudioPutSlot):Promise<void>{closeSelectedStudioPutSlot(slot);await state(slot).completion.catch(()=>{});}
/** Private owner observer, never an HTTP status endpoint. Resolution proves
 * this slot's actual PUT transaction returned from COMMIT and the retained
 * owner remained live. Rejection waits for already-started work to settle;
 * it grants no cleanup/release or retry authority. */
export function awaitSelectedStudioPut(slot:SelectedStudioPutSlot):Promise<Readonly<StudioResponse>>{return state(slot).completion;}
const current=(entry:Entry)=>{if(entry.closed)throw new ApiError(409,'NATIVE_STUDIO_CLOSED');};
const exactSession=(s:Session,c:Readonly<SelectedStudioClaim>)=>{if(s.id!==c.sessionId||s.tenantId!==c.tenantId||s.userId!==c.principalId||!['admin','artist','curator'].includes(s.role))throw new ApiError(403,'FORBIDDEN');};
function snapshot(input:SelectedStudioClaim):Readonly<SelectedStudioClaim>{
 const names=['sessionId','tenantId','principalId','workspaceId','runtimeGeneration','jobId','attemptId','generation','stageId','reservationId','reservationGeneration','exhibitionId','requestId'] as const;
 if(!input||Reflect.ownKeys(input).length!==names.length||Reflect.ownKeys(input).some(k=>typeof k!=='string'||!names.includes(k as typeof names[number])))throw Error('NATIVE_STUDIO_CONFIGURATION');
 const copy={} as SelectedStudioClaim;
 for(const name of names){const d=Object.getOwnPropertyDescriptor(input,name);if(!d||!('value'in d))throw Error('NATIVE_STUDIO_CONFIGURATION');uuid(d.value);if(d.value!==d.value.toLowerCase())throw Error('NATIVE_STUDIO_CONFIGURATION');copy[name]=d.value;}
 return Object.freeze(copy);
}
/** One PRIVATE arm attempt, after import COMMIT, never a route/body/header/env
 * operation. It independently performs the current authenticated DB GET and
 * captures that GET's ETag only after the whole bounded READ COMMITTED
 * transaction settles. It never receives or reads a token or token hash.
 * Actual same-claim issuer/bootstrap integration remains outside this module. */
export async function armSelectedStudioPut(slot:SelectedStudioPutSlot,owner:SelectedStudioOwner,input:SelectedStudioClaim):Promise<StudioResponse>{
 const entry=state(slot);if(entry.attempted||entry.closed){closeSelectedStudioPutSlot(slot);throw new ApiError(409,'NATIVE_STUDIO_CLOSED');}entry.attempted=true;entry.arming=true;
 let actual:Promise<StudioResponse>|undefined;
 try{
  const claim=snapshot(input),binding=entry.binding;if(!binding||!owner||typeof owner.assertCommittedImport!=='function'||typeof owner.assertDatabase!=='function'||typeof owner.assertLive!=='function'||typeof owner.runScoped!=='function')throw Error('NATIVE_STUDIO_CONFIGURATION');
  const retained:SelectedStudioOwner={assertCommittedImport:owner.assertCommittedImport.bind(owner),assertDatabase:owner.assertDatabase.bind(owner),assertLive:owner.assertLive.bind(owner),runScoped:owner.runScoped.bind(owner)};
  await retained.runScoped(()=>{
   if(actual)throw Error('NATIVE_STUDIO_SCOPE');
   actual=(async()=>{
    current(entry);await retained.assertCommittedImport(claim);await retained.assertLive();current(entry);
    const value=await transaction(binding.auth.pool,async c=>{
     await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
     await c.query("SET LOCAL statement_timeout='10s'");await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
     await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
     await retained.assertDatabase(c);current(entry);
     const read=async(roles:readonly string[],lock:boolean)=>{
      const result=await c.query(`SELECT a.id,a.user_id,a.tenant_id,a.expires_at,m.role FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL AND m.role=ANY($4::text[])${lock?' FOR SHARE OF a,u,m,t':''}`,[claim.sessionId,claim.tenantId,claim.principalId,roles]);
      if(result.rows.length!==1)throw new ApiError(403,'FORBIDDEN');const row=result.rows[0];
      // Studio.get uses identity/role only. No CSRF secret is read or issued;
      // mutation still requires the client's normal Auth.request check.
      const s:Session={id:row.id,userId:row.user_id,tenantId:row.tenant_id,role:row.role,csrfToken:'',expiresAt:row.expires_at.toISOString()};exactSession(s,claim);if(!roles.includes(s.role))throw new ApiError(403,'FORBIDDEN');return s;
     };
     const s=await read(['admin','artist','curator'],true);current(entry);await retained.assertLive();
     const result=await binding.studio.get(c,s,claim.exhibitionId);await retained.assertLive();current(entry);
     // Fresh clock/authority check AFTER all row locks, immediately before
     // transaction() COMMIT. No token transport and no adopted precommit GET.
     await retained.assertDatabase(c);current(entry);await read([s.role],false);return result;
    });
    await retained.assertCommittedImport(claim);await retained.assertLive();current(entry);return value;
   })();return actual;
  });
  if(!actual)throw Error('NATIVE_STUDIO_SCOPE');const result=await actual;
  current(entry);const etag=requiredMatch(result.etag);if(result.draft.exhibitionId!==claim.exhibitionId)throw Error('NATIVE_STUDIO_CONFIGURATION');
  entry.armed={claim,owner:retained,etag,body:{draft:structuredClone(result.draft),requestId:claim.requestId}};return structuredClone(result);
 }catch(error){entry.closed=true;throw error;}finally{await actual?.catch(()=>{});entry.arming=false;if(entry.closed)finish(entry);}
}
async function release(req:FastifyRequest){
 const a=entries.get(req);if(!a||a.released)return;
 await a.admitting?.catch(()=>{});await a.body;await a.scoped?.catch(()=>{});await a.actual?.catch(()=>{});
 if(a.released)return;a.released=true;a.detach();entries.delete(req);a.slot.active=undefined;
}
async function fail(req:FastifyRequest){const a=entries.get(req);if(!a)return;a.failed=true;a.slot.closed=true;await release(req);finish(a.slot);}
const studioPath='/api/v1/tenants/:tenantId/studio/exhibitions/:id';
const uploadPath='/api/v1/tenants/:tenantId/native-oex/imports';
/** Register before listen, ONLY in explicitly fresh selected native scope.
 * This scope must contain ALL mutation routes. No slot => caller must leave
 * ordinary registration unchanged. Upload paths still require their own
 * private capability checks; matching a route here grants no upload authority.
 * After arming begins even upload writes are denied. No new HTTP route exists. */
export function registerSelectedStudioPutGate(app:FastifyInstance,auth:Auth,input:AuthConfig,studio:Studio,slot:SelectedStudioPutSlot):void{
 const entry=state(slot),settings=config(input);
 if(entry.binding||entry.attempted||entry.closed||settings.mode!=='local'||!(auth instanceof Auth)||!(studio instanceof Studio))throw Error('NATIVE_STUDIO_CONFIGURATION');
 entry.binding={auth,studio,settings};
 app.addHook('onRequest',async(req,reply)=>{
  if(req.method==='GET'||req.method==='HEAD')return;
  const route=req.routeOptions.url;
  if(!entry.attempted&&!entry.closed&&(req.method==='POST'&&(route===uploadPath||route===uploadPath+'/:id/queue')||req.method==='PUT'&&route===uploadPath+'/:id/chunks/:index'))return;
  reply.header('cache-control','no-store');
  if(req.method!=='PUT'||route!==studioPath)throw new ApiError(403,'NATIVE_SELECTED_WRITE_DENIED');
  traceNativeOexSelected('put-received');
  const armed=entry.armed;current(entry);if(!armed||entry.used)throw new ApiError(409,'NATIVE_STUDIO_UNAVAILABLE');
  if(req.headers.host!==settings.host||req.headers.origin!==settings.origin)throw new ApiError(403,'ORIGIN_REJECTED');
  const p=req.params as {tenantId:string;id:string};if(p.tenantId!==armed.claim.tenantId||p.id!==armed.claim.exhibitionId)throw new ApiError(403,'FORBIDDEN');
  if(requiredMatch(req.headers['if-match'])!==armed.etag)throw new ApiError(412,'REMOTE_CONFLICT');
  if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['content-encoding']!==undefined&&req.headers['content-encoding']!=='identity')throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');
  const length=req.headers['content-length'];if(length!==undefined&&(!/^[0-9]+$/.test(length)||Number(length)>1048576))throw new ApiError(413,'BODY_TOO_LARGE');
  entry.used=true; // Irreversible BEFORE any body is read, including malformed JSON.
  const a:Admission={slot:entry,armed,failed:false,released:false,cancelled:false,bodySettled:false,cancelIncoming:()=>{},detach:()=>{}};entries.set(req,a);entry.active=req;
  a.cancelIncoming=()=>{
   if(a.released||a.bodySettled)return;a.cancelled=true;a.failed=true;
   // Only this admitted incoming stream; owner/DB/blob/server resources must
   // remain live until the parser and actual transaction have settled.
   a.payload?.destroy();if(!req.raw.readableEnded)req.raw.destroy();
  };
  const aborted=()=>{void fail(req);},closed=()=>{if(!reply.raw.writableFinished)void fail(req);};
  req.raw.once('aborted',aborted);reply.raw.once('close',closed);a.detach=()=>{req.raw.removeListener('aborted',aborted);reply.raw.removeListener('close',closed);};
  a.admitting=Promise.resolve().then(()=>armed.owner.assertLive());
  try{await a.admitting;current(entry);if(a.failed)throw new ApiError(409,'NATIVE_STUDIO_CLOSED');traceNativeOexSelected('put-admitted');}catch(error){await fail(req);throw error;}
 });
 app.addHook('preParsing',async(req,_reply,payload)=>{
  const a=entries.get(req);if(!a)return payload;
  a.payload=payload;a.body=new Promise<void>(resolve=>{a.bodyDone=()=>{a.bodySettled=true;resolve();};});
  const terminal=()=>{a.bodyDone?.();};payload.once('error',terminal);payload.once('close',terminal);
  const detach=a.detach;a.detach=()=>{detach();payload.removeListener('error',terminal);payload.removeListener('close',terminal);};
  if(a.cancelled){payload.destroy();void fail(req);}return payload;
 });
 app.addHook('preValidation',async req=>{entries.get(req)?.bodyDone?.();});
 app.addHook('onError',async req=>{if(req.method==='PUT'&&req.routeOptions.url===studioPath)traceNativeOexSelected('put-rejected');entries.get(req)?.bodyDone?.();await fail(req);});app.addHook('onResponse',async req=>{await release(req);});app.addHook('onRequestAbort',async req=>{await fail(req);});
}
/** Owner changes ONLY the existing selected-mode PUT wrapper to call this
 * around its existing Studio.put callback. Keep existing body schema/limit,
 * Studio.put checks, ETag response and normal-mode handler unchanged. This
 * owns the entire normal Auth.request, not just its pre-COMMIT callback. */
export async function runSelectedStudioPut(slot:SelectedStudioPutSlot,req:FastifyRequest,reply:FastifyReply,work:(c:PoolClient,s:Session)=>Promise<StudioResponse>):Promise<StudioResponse>{
 const entry=state(slot),a=entries.get(req),binding=entry.binding;
 if(!a||a.slot!==entry||a.released||a.failed||!binding||a.scoped)throw new ApiError(409,'NATIVE_STUDIO_CLOSED');
 const {claim,owner}=a.armed,check=()=>{current(entry);if(a.failed)throw new ApiError(409,'NATIVE_STUDIO_CLOSED');};
 const cookies=(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(binding.settings.cookieName+'='));const token=cookies.length===1?cookies[0]!.slice(binding.settings.cookieName.length+1):undefined;
 reply.header('cache-control','no-store');
 a.scoped=Promise.resolve().then(()=>owner.runScoped(()=>{
  if(a.actual)throw Error('NATIVE_STUDIO_SCOPE');
  a.actual=(async()=>{
   check();await owner.assertLive();check();
   const result=await binding.auth.request(token,claim.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,true,async(c,s)=>{
    exactSession(s,claim);check();if(!isDeepStrictEqual(req.body,a.armed.body))throw new ApiError(409,'NATIVE_STUDIO_BODY_CONFLICT');traceNativeOexSelected('put-body-matched');await owner.assertDatabase(c);check();await owner.assertLive();check();const value=await work(c,s);await owner.assertLive();check();await owner.assertDatabase(c);check();return value;
   });
   traceNativeOexSelected('put-commit-returned');await owner.assertLive();check();return result;
  })();return a.actual;
 })).catch(error=>{entry.closed=true;throw error;});
 let committed:StudioResponse|undefined;
 try{await a.scoped;if(!a.actual)throw Error('NATIVE_STUDIO_SCOPE');const result=await a.actual as StudioResponse;check();committed=result;traceNativeOexSelected('put-scope-returned');return result;}catch(error){entry.closed=true;throw error;}finally{await release(req);const successful=!entry.closed&&!a.failed;entry.closed=true;finish(entry,successful?committed:undefined);}
}
