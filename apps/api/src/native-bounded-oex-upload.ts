// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {Auth,ApiError,config,uuid,type AuthConfig,type Session} from './auth.ts';
import {createBoundedOexJob,putBoundedOexChunk,queueBoundedOexJob} from './oex-bounded-chunks.ts';

const CHUNK=16*1024*1024,MAX=512*1024*1024,hex=/^[a-f0-9]{64}$/;
export interface SelectedNativeUpload {
 /** Exact server Auth session ID from authenticated native bootstrap, never
  * an HTTP field or another session of the same personal principal. */
 sessionId:string;tenantId:string;principalId:string;workspaceId:string;runtimeGeneration:string;
 requestId:string;bytes:number;sha256:string;
}
/** Implemented ONLY by the future authenticated native bootstrap. It must
 * hold and revalidate the same actual Session, retained owner connection and
 * supported-workspace writer fence around the ENTIRE callback, including the
 * auth transaction's COMMIT. A digest, PID, frame or caller boolean cannot
 * implement this authority. No production issuer/registration exists yet. */
export interface NativeUploadOwner {
 assertLive():Promise<void>;
 /** Same transaction client: verify pinned DB system/OID + store identity.
  * Complements, never substitutes for, Auth/CSRF/Session and owner fences. */
 assertDatabase(c:PoolClient):Promise<void>;
 runScoped<T>(work:()=>Promise<T>):Promise<T>;
}
declare const privateCapability:unique symbol;
export interface NativeBoundedUploadCapability {readonly [privateCapability]:true}
interface State {selection:Readonly<SelectedNativeUpload>;assertLive:()=>Promise<void>;assertDatabase:NativeUploadOwner['assertDatabase'];runScoped:NativeUploadOwner['runScoped'];busy:boolean;closed:boolean;queued:boolean;jobId?:string;active:Set<Promise<void>>;cancelIncoming:Set<()=>void>}
const issued=new WeakMap<NativeBoundedUploadCapability,State>();

/** Internal configuration seam for a FUTURE native-bootstrap caller only.
 * This factory does not authenticate an owner. Never call it from a route,
 * environment/HTTP parser or receipt loader; never reconstruct after loss.
 * Nothing in this module wires a bootstrap or enables the selected mode. */
export function bindSelectedNativeUpload(owner:NativeUploadOwner,input:SelectedNativeUpload):NativeBoundedUploadCapability{
 const names=['sessionId','tenantId','principalId','workspaceId','runtimeGeneration','requestId','bytes','sha256'] as const;
 if(!input||typeof input!=='object'||Reflect.ownKeys(input).length!==names.length||Reflect.ownKeys(input).some(key=>typeof key!=='string'||!names.includes(key as typeof names[number])))throw Error('NATIVE_UPLOAD_CONFIGURATION');
 const snapshot:Record<string,unknown>={};for(const name of names){const d=Object.getOwnPropertyDescriptor(input,name);if(!d||!('value'in d))throw Error('NATIVE_UPLOAD_CONFIGURATION');snapshot[name]=d.value;}
 for(const name of names.slice(0,6)){uuid(snapshot[name]);if(snapshot[name]!==String(snapshot[name]).toLowerCase())throw Error('NATIVE_UPLOAD_CONFIGURATION');}
 if(!Number.isSafeInteger(snapshot.bytes)||Number(snapshot.bytes)<1||Number(snapshot.bytes)>MAX||typeof snapshot.sha256!=='string'||!hex.test(snapshot.sha256)||!owner||typeof owner.assertLive!=='function'||typeof owner.assertDatabase!=='function'||typeof owner.runScoped!=='function')throw Error('NATIVE_UPLOAD_CONFIGURATION');
 const capability=Object.freeze(Object.create(null)) as NativeBoundedUploadCapability;
 issued.set(capability,{selection:Object.freeze(snapshot) as unknown as Readonly<SelectedNativeUpload>,assertLive:owner.assertLive.bind(owner),assertDatabase:owner.assertDatabase.bind(owner),runScoped:owner.runScoped.bind(owner),busy:false,closed:false,queued:false,active:new Set(),cancelIncoming:new Set()});
 return capability;
}

declare const privateSlot:unique symbol;
export interface NativeBoundedUploadSlot {readonly [privateSlot]:true}
interface UploadSlot {attempted:boolean;closed:boolean;capability?:NativeBoundedUploadCapability;installing?:Promise<void>}
const slots=new WeakMap<NativeBoundedUploadSlot,UploadSlot>();
/** Future fresh-selected native bootstrap only, BEFORE listen. No HTTP field
 * can create, install, reopen or replace this process-local slot. */
export function createSelectedNativeUploadSlot():NativeBoundedUploadSlot{
 const slot=Object.freeze(Object.create(null)) as NativeBoundedUploadSlot;slots.set(slot,{attempted:false,closed:false});return slot;
}
export function closeSelectedNativeUploadSlot(slot:NativeBoundedUploadSlot):void{
 const entry=slots.get(slot);if(!entry)throw Error('NATIVE_UPLOAD_SLOT');entry.closed=true;
 if(entry.capability){const state=issued.get(entry.capability)!;state.closed=true;for(const cancel of [...state.cancelIncoming])cancel();}
}
/** Private owner finally must await this BEFORE closing root/payload/Session
 * handles. Closing authorization alone is not drain evidence. This closes
 * synchronously, cancels ONLY admitted incoming streams, then waits for
 * installation and every admitted body/parser,
 * owner scope and actual Auth COMMIT/blob operation. It never grants success,
 * retry, cleanup or lease-retirement authority, even when operations failed. */
export async function drainSelectedNativeUploadSlot(slot:NativeBoundedUploadSlot):Promise<void>{
 closeSelectedNativeUploadSlot(slot);const entry=slots.get(slot)!;
 await entry.installing?.catch(()=>{});
 const state=entry.capability?issued.get(entry.capability):undefined;
 if(state)await Promise.all([...state.active]);
}
/** Exactly ONE private install attempt after the native selection frame and
 * authenticated current server Session.id resolution. Input remains a config
 * seam, NOT evidence that this missing socket/bootstrap issuer exists.
 * Invalid selection, lost owner or reinstallation permanently closes it. */
export async function installSelectedNativeUpload(slot:NativeBoundedUploadSlot,owner:NativeUploadOwner,input:SelectedNativeUpload):Promise<void>{
 const entry=slots.get(slot);if(!entry)throw Error('NATIVE_UPLOAD_SLOT');
 if(entry.attempted||entry.closed){closeSelectedNativeUploadSlot(slot);throw Error('NATIVE_UPLOAD_SLOT_CLOSED');}entry.attempted=true;
 let candidate:NativeBoundedUploadCapability|undefined;
 try{
  candidate=bindSelectedNativeUpload(owner,input);const selected=issued.get(candidate)!;
  entry.installing=Promise.resolve().then(()=>selected.assertLive());await entry.installing;
  if(entry.closed)throw Error('NATIVE_UPLOAD_SLOT_CLOSED');entry.capability=candidate;
 }catch(error){entry.closed=true;if(candidate)issued.get(candidate)!.closed=true;throw error;}
}
/** Register BEFORE listen only in explicitly fresh-selected native mode. The
 * parent gate still denies unrelated writes. Before private installation every
 * request is refused before body parsing; listen does not grant authority. */
export function registerSelectedNativeOexUploadSlot(app:FastifyInstance,auth:Auth,input:AuthConfig,blobs:FileBlobStore,slot:NativeBoundedUploadSlot){
 const entry=slots.get(slot);if(!entry)throw Error('NATIVE_UPLOAD_SLOT');
 registerUploadRoutes(app,auth,input,blobs,()=>!entry.closed&&entry.capability?issued.get(entry.capability):undefined);
}

/** Separate, inactive selected-mode endpoints. No capability => no routes.
 * Ordinary auth/OEX routes, their parsers and worker behavior are untouched.
 * The bootstrap must pass a real issued capability and actual Auth instance;
 * installing this seam is NOT the missing Session/claim handler integration. */
export function registerSelectedNativeOexUpload(app:FastifyInstance,auth:Auth,input:AuthConfig,blobs:FileBlobStore,capability?:NativeBoundedUploadCapability){
 if(capability===undefined)return;
 const state=issued.get(capability);if(!state)throw Error('NATIVE_UPLOAD_CAPABILITY');
 registerUploadRoutes(app,auth,input,blobs,()=>state);
}
function registerUploadRoutes(app:FastifyInstance,auth:Auth,input:AuthConfig,blobs:FileBlobStore,resolveState:()=>State|undefined){
 const settings=config(input);if(settings.mode!=='local'||!(auth instanceof Auth)||!(blobs instanceof FileBlobStore))throw Error('NATIVE_UPLOAD_CONFIGURATION');
 const token=(req:FastifyRequest)=>{const values=(req.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(settings.cookieName+'='));return values.length===1?values[0]!.slice(settings.cookieName.length+1):undefined;};
 const guard=(req:FastifyRequest)=>{
  if(req.headers.host!==settings.host||req.headers.origin!==settings.origin)throw new ApiError(403,'ORIGIN_REJECTED');
  if(req.headers['content-encoding']!==undefined&&req.headers['content-encoding']!=='identity')throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');
  uuid((req.params as {tenantId:string}).tenantId);
 };
 type Admission={state:State;released:boolean;failed:boolean;cancelled:boolean;bodySettled:boolean;payload?:import('node:stream').Readable;cancelIncoming:()=>void;admitting?:Promise<void>;body?:Promise<void>;bodyDone?:()=>void;work?:Promise<unknown>;actual?:Promise<unknown>;done:Promise<void>;finish:()=>void;detach:()=>void};
 const admitted=new WeakMap<FastifyRequest,Admission>();
 const release=async(req:FastifyRequest)=>{
  const entry=admitted.get(req);if(!entry||entry.released)return;
  await entry.admitting?.catch(()=>{});await entry.body;await entry.work?.catch(()=>{});await entry.actual?.catch(()=>{});
  if(entry.released)return;entry.released=true;entry.detach();admitted.delete(req);entry.state.busy=false;entry.state.cancelIncoming.delete(entry.cancelIncoming);entry.state.active.delete(entry.done);entry.finish();
 };
 const fail=async(req:FastifyRequest)=>{const entry=admitted.get(req);if(!entry)return;entry.failed=true;entry.state.closed=true;await release(req);};
 const onRequest=(kind:'create'|'chunk'|'queue')=>async(req:FastifyRequest,reply:import('fastify').FastifyReply)=>{
  reply.header('cache-control','no-store');guard(req);const state=resolveState();
  if(!state)throw new ApiError(409,'NATIVE_UPLOAD_UNAVAILABLE');
  if((req.params as {tenantId:string}).tenantId!==state.selection.tenantId)throw new ApiError(403,'FORBIDDEN');
  if(state.closed||state.queued)throw new ApiError(409,'NATIVE_UPLOAD_CLOSED');if(state.busy)throw new ApiError(409,'NATIVE_UPLOAD_BUSY');
  if(kind!=='create'){const {id}=req.params as {id:string};uuid(id);if(id!==state.jobId)throw new ApiError(403,'FORBIDDEN');}
  const declared=req.headers['content-length'];
  if(kind==='chunk'){
   const {index}=req.params as {index:string};if(!/^(0|[1-9][0-9]?)$/.test(index)||Number(index)>=Math.ceil(state.selection.bytes/CHUNK))throw new ApiError(400,'INVALID_INPUT');
   if(req.headers['content-type']!=='application/octet-stream')throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');
   const digest=req.headers['x-exhibitos-chunk-sha256'];if(typeof digest!=='string'||!hex.test(digest))throw new ApiError(422,'UPLOAD_INTEGRITY');
   const expected=Math.min(CHUNK,state.selection.bytes-Number(index)*CHUNK);
   if(declared!==undefined){if(!/^[1-9][0-9]*$/.test(declared))throw new ApiError(400,'INVALID_INPUT');if(Number(declared)>CHUNK)throw new ApiError(413,'BODY_TOO_LARGE');if(Number(declared)!==expected)throw new ApiError(400,'INVALID_INPUT');}
  }else if(declared!==undefined&&(!/^[0-9]+$/.test(declared)||Number(declared)>1024))throw new ApiError(413,'BODY_TOO_LARGE');
  // Acquire BEFORE Fastify reads/buffers the body; the handler consumes this
  // exact admission rather than opening a second slot after parsing.
  state.busy=true;
  let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});state.active.add(done);
  const entry:Admission={state,released:false,failed:false,cancelled:false,bodySettled:false,cancelIncoming:()=>{},done,finish,detach:()=>{}};admitted.set(req,entry);
  entry.cancelIncoming=()=>{
   if(entry.released||entry.bodySettled)return;
   entry.cancelled=true;entry.failed=true;
   // Request-local cancellation only. Never destroy an owner, DB client,
   // blob handle, listening server or another client's incoming stream.
   entry.payload?.destroy();if(!req.raw.readableEnded)req.raw.destroy();
   void fail(req); // release still awaits parser terminal and actual work.
  };state.cancelIncoming.add(entry.cancelIncoming);
  const aborted=()=>{void fail(req);},closed=()=>{if(!reply.raw.writableFinished)void fail(req);};
  req.raw.once('aborted',aborted);reply.raw.once('close',closed);
  entry.detach=()=>{req.raw.removeListener('aborted',aborted);reply.raw.removeListener('close',closed);};
  entry.admitting=Promise.resolve().then(()=>state.assertLive());
  try{await entry.admitting;if(state.closed||entry.failed)throw new ApiError(409,'NATIVE_UPLOAD_CLOSED');}
  catch(error){await fail(req);throw error;}
 };
 const run=async<T>(req:FastifyRequest,work:(c:PoolClient,s:Session)=>Promise<T>,afterCommit?:(result:T)=>void):Promise<T>=>{
  const entry=admitted.get(req);if(!entry||entry.released||entry.failed||entry.state.closed)throw new ApiError(409,'NATIVE_UPLOAD_CLOSED');
  const state=entry.state;const current=()=>{if(entry.failed||state.closed)throw new ApiError(409,'NATIVE_UPLOAD_CLOSED');};
  entry.work=Promise.resolve().then(()=>state.runScoped(()=>{
   // Track callback work independently: an owner failure must not release the
   // admission while an already-started transaction is still settling.
   const actual=(async()=>{
    current();await state.assertLive();current();
    // Await the WHOLE auth.request promise: its work callback is pre-COMMIT.
    const result=await auth.request(token(req),state.selection.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,true,async(c,s)=>{
     if(s.id!==state.selection.sessionId||s.tenantId!==state.selection.tenantId||s.userId!==state.selection.principalId||!['admin','artist'].includes(s.role))throw new ApiError(403,'FORBIDDEN');
     current();await state.assertDatabase(c);current();await state.assertLive();current();const value=await work(c,s);await state.assertLive();current();await state.assertDatabase(c);current();return value;
    });
    await state.assertLive();current();afterCommit?.(result);return result;
   })();entry.actual=actual;return actual;
  })).catch(error=>{state.closed=true;throw error;});
  try{return await entry.work as T;}finally{await release(req);}
 };
 app.register(async scoped=>{
  scoped.addHook('preParsing',async(req,_reply,payload)=>{
   const entry=admitted.get(req);if(!entry)return payload;
   entry.payload=payload;entry.body=new Promise<void>(resolve=>{entry.bodyDone=()=>{entry.bodySettled=true;resolve();};});
   const terminal=()=>{entry.bodyDone?.();};payload.once('error',terminal);payload.once('close',terminal);
   const detach=entry.detach;entry.detach=()=>{detach();payload.removeListener('error',terminal);payload.removeListener('close',terminal);};
   if(entry.cancelled){payload.destroy();void fail(req);}
   return payload;
  });
  scoped.addHook('preValidation',async req=>{admitted.get(req)?.bodyDone?.();});
  scoped.addHook('onError',async req=>{admitted.get(req)?.bodyDone?.();await fail(req);});
  scoped.addHook('onResponse',async req=>{await release(req);});
  scoped.addHook('onRequestAbort',async req=>{await fail(req);});
  // Content parsers are encapsulated; never change ordinary upload parsers.
  if(scoped.hasContentTypeParser('application/octet-stream'))scoped.removeContentTypeParser('application/octet-stream');
  scoped.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:CHUNK},(_req,body,done)=>done(null,body));
  const path='/api/v1/tenants/:tenantId/native-oex/imports';
  scoped.post(path,{bodyLimit:1024,onRequest:onRequest('create')},async(req,reply)=>{
   reply.header('cache-control','no-store');
   const state=admitted.get(req)!.state;const result=await run(req,async(c,s)=>{
    const value=req.body;if(req.headers['content-type']?.split(';')[0]!=='application/json'||!value||typeof value!=='object'||Array.isArray(value)||Buffer.isBuffer(value)||Object.keys(value).sort().join(',')!=='bytes,requestId,sha256')throw new ApiError(400,'INVALID_INPUT');
    const body=value as {requestId:string;bytes:number;sha256:string},selected=state.selection;
    if(body.requestId!==selected.requestId||body.bytes!==selected.bytes||body.sha256!==selected.sha256)throw new ApiError(409,'REQUEST_CONFLICT');
    const created=await createBoundedOexJob(c,s,body);uuid(created.id);if(created.id!==created.id.toLowerCase()||state.jobId!==undefined&&created.id!==state.jobId||created.state!=='uploading')throw new ApiError(409,'NATIVE_UPLOAD_CLOSED');return created;
   },created=>{state.jobId=created.id;});
   return reply.code(201).send(result);
  });
  scoped.put(path+'/:id/chunks/:index',{bodyLimit:CHUNK,onRequest:onRequest('chunk')},async(req,reply)=>{
   reply.header('cache-control','no-store');const state=admitted.get(req)!.state;return run(req,async(c,s)=>{
    const {id,index} =req.params as {id:string;index:string};uuid(id);
    if(id!==state.jobId)throw new ApiError(403,'FORBIDDEN');
    if(!/^(0|[1-9][0-9]?)$/.test(index)||Number(index)>31)throw new ApiError(400,'INVALID_INPUT');
    if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');
    const bytes=req.body,digest=req.headers['x-exhibitos-chunk-sha256'];
    if(bytes.length<1||bytes.length>CHUNK)throw new ApiError(413,'BODY_TOO_LARGE');
    if(typeof digest!=='string'||!hex.test(digest)||createHash('sha256').update(bytes).digest('hex')!==digest)throw new ApiError(422,'UPLOAD_INTEGRITY');
    const declared=req.headers['content-length'];if(declared!==undefined&&(!/^[1-9][0-9]*$/.test(declared)||Number(declared)!==bytes.length))throw new ApiError(400,'INVALID_INPUT');
    return putBoundedOexChunk(c,s,id,Number(index),bytes,blobs);
   });
  });
  scoped.post(path+'/:id/queue',{bodyLimit:1024,onRequest:onRequest('queue')},async(req,reply)=>{
   reply.header('cache-control','no-store');const state=admitted.get(req)!.state;return run(req,async(c,s)=>{
    const {id}=req.params as {id:string};uuid(id);if(id!==state.jobId)throw new ApiError(403,'FORBIDDEN');
    if(req.headers['content-type']?.split(';')[0]!=='application/json'||!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Buffer.isBuffer(req.body)||Object.keys(req.body).length)throw new ApiError(400,'INVALID_INPUT');
    return queueBoundedOexJob(c,s,id,blobs);
   },()=>{state.queued=true;});
  });
 });
}
