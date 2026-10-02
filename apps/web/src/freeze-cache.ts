// SPDX-License-Identifier: AGPL-3.0-or-later
import type {FreezeBundle} from '@exhibitos/studio-contract';
export interface OfflineAuthority {authority:{origin:string;keyId:string;publicKey:string};tenantId:string;subjectId:string;expiresAt:string;portableMode?:boolean}
export interface FreezeRecord {key:string;scope:string;freezeId:string;title:string;bytes:Uint8Array;authority:OfflineAuthority;expiresAt:string;preparedAt:string}
export const authorityScope=(a:OfflineAuthority)=>JSON.stringify([a.authority.origin,a.tenantId,a.subjectId]);
export const freezeRecordKey=(a:OfflineAuthority,b:FreezeBundle)=>JSON.stringify([authorityScope(a),b.manifest.id,b.authorization.grant.issuedAt]);
const DB='exhibitos-verified-freezes-v1';
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('records',{keyPath:'key'});r.result.createObjectStore('control');};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});}
async function transaction<T>(stores:string[],mode:IDBTransactionMode,action:(tx:IDBTransaction,done:(value:T)=>void)=>void):Promise<T>{const db=await database();return new Promise<T>((resolve,reject)=>{const tx=db.transaction(stores,mode);let result:T;tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error??Error('OFFLINE_CACHE_FAILED'));};tx.onerror=()=>{};try{action(tx,v=>{result=v;});}catch(error){tx.abort();db.close();reject(error);}});}
// Account profile writes/invalidation are ordered even when IndexedDB opens resolve out of order.
let profileWrites:Promise<void>=Promise.resolve();
function profileWrite(action:(tx:IDBTransaction,done:(value:void)=>void)=>void){
 const next=profileWrites.then(()=>transaction<void>(['control'],'readwrite',action));
 profileWrites=next.catch(()=>{});return next;
}
/** Add, never put: a failed/duplicate/quota import cannot overwrite an earlier verified package. */
export function addFreezeRecord(record:FreezeRecord,guard:()=>void=()=>{}){return transaction<void>(['records'],'readwrite',(tx,done)=>{guard();tx.objectStore('records').add(record);done();});}
export function listFreezeRecords(scope:string){return transaction<FreezeRecord[]>(['records'],'readonly',(tx,done)=>{const r=tx.objectStore('records').getAll();r.onsuccess=()=>done((r.result as FreezeRecord[]).filter(x=>x.scope===scope));});}
export function saveOfflineAuthority(authority:OfflineAuthority,guard:()=>void=()=>{}){return profileWrite((tx,done)=>{guard();const store=tx.objectStore('control');store.put(authority,'profile');store.put(offlineAuthMarker(),'profileAuthMarker');done();});}
export function readOfflineAuthority(){return transaction<OfflineAuthority|undefined>(['control'],'readonly',(tx,done)=>{const r=tx.objectStore('control').get('profile');r.onsuccess=()=>{const profile=r.result as OfflineAuthority|undefined,marker=tx.objectStore('control').get('profileAuthMarker');marker.onsuccess=()=>done(marker.result===offlineAuthMarker()?profile:undefined);};});}
/** Persistent monotonic wall-clock guard. Even a reload cannot reopen a grant after clock rollback. */
export function observeOfflineTime(now?:number){return transaction<boolean>(['control'],'readwrite',(tx,done)=>{const store=tx.objectStore('control'),r=store.get('maxObservedTime');r.onsuccess=()=>{const observed=now??Date.now(),last=typeof r.result==='number'?r.result:0;if(!Number.isFinite(observed)||observed<last){done(false);return;}store.put(observed,'maxObservedTime');done(true);};});}

/** Invalidating an account retains package bytes but removes the selected cached authority. */
export function clearOfflineAuthority(){return profileWrite((tx,done)=>{tx.objectStore('control').delete('profile');tx.objectStore('control').delete('profileAuthMarker');done();});}
export function offlineAuthMarker():string|null{try{return localStorage.getItem('exhibitos-auth-change')??'';}catch{return null;}}
export function offlineOperation(generation:{current:number}){
 const epoch=generation.current,marker=offlineAuthMarker();
 const valid=()=>generation.current===epoch&&offlineAuthMarker()===marker;
 const assert=()=>{if(!valid())throw Error('OFFLINE_OPERATION_CANCELLED');};
 return {valid,assert,async wait<T>(work:Promise<T>):Promise<T>{const result=await work;assert();return result;}};
}
export type OfflineOperation=ReturnType<typeof offlineOperation>;
