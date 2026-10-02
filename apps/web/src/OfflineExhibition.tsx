// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useRef,useState} from 'react';
import {MAX_FREEZE_BYTES,verifyFreezeBundle,freezeCanonical,type FreezeBundle} from '@exhibitos/studio-contract';
import {PublicPublication} from './PublicPublication';
import type {PublicPublication as PublicResponse} from './publication-client';
import {decodeFreezeOex,freezeHash,type FrozenOex} from './freeze-oex';
import {addFreezeRecord,authorityScope,freezeRecordKey,listFreezeRecords,observeOfflineTime,readOfflineAuthority,saveOfflineAuthority,type FreezeRecord,type OfflineAuthority} from './freeze-cache';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function bounded(response:Response,limit:number){if(!response.ok||!response.body)throw Error('OFFLINE_RESPONSE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('OFFLINE_SIZE');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return bytes;}
async function json(response:Response){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,1048576))) as unknown;}
export async function fetchOfflineAuthority(portable=false):Promise<OfflineAuthority>{
 const raw=await json(await fetch(portable?'/offline-authority':'/api/v1/freeze/authority',{credentials:portable?'omit':'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)}));
 if(!raw||typeof raw!=='object')throw Error('OFFLINE_AUTHORITY');const a=raw as OfflineAuthority;
 if(!a.authority||typeof a.authority.publicKey!=='string'||!/^[a-f0-9]{64}$/.test(a.authority.keyId)||!uuid.test(a.tenantId)||!uuid.test(a.subjectId)||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now()||(!portable&&a.authority.origin!==location.origin)||(portable&&a.portableMode!==true))throw Error('OFFLINE_AUTHORITY');
 return a;
}
export function matchOfflineAuthority(a:OfflineAuthority,b:FreezeBundle){const g=b.authorization.grant;if(g.origin!==a.authority.origin||g.keyId!==a.authority.keyId||g.tenantId!==a.tenantId||g.subjectId!==a.subjectId||b.manifest.authority.publicKey!==a.authority.publicKey)throw Error('OFFLINE_PROFILE');}
export async function assertFreezeRuntime(b:FreezeBundle){const raw=await json(await fetch('/freeze-runtime.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)})) as {coreDigest?:string};if(raw?.coreDigest!==b.manifest.runtime.coreDigest)throw Error('OFFLINE_RUNTIME_UNSUPPORTED');}
export async function assertFreezeOnline(a:OfflineAuthority,b:FreezeBundle){
 if(a.portableMode||!navigator.onLine)return;
 const current=await fetchOfflineAuthority();if(authorityScope(a)!==authorityScope(current)||a.authority.keyId!==current.authority.keyId)throw Error('OFFLINE_PROFILE_CHANGED');
 const path=`/api/v1/tenants/${a.tenantId}/studio/exhibitions/${b.manifest.source.exhibitionId}/freezes/${b.manifest.id}/check`;
 const raw=await json(await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)})) as {allowed?:boolean;freezeId?:string;manifestSha256?:string};
 if(raw?.allowed!==true||raw.freezeId!==b.manifest.id||raw.manifestSha256!==await freezeHash(new TextEncoder().encode(freezeCanonical(b.manifest))))throw Error('OFFLINE_CURRENT_RIGHTS');
}
/** Strict standard asset URLs resolve only to already verified bytes. Never falls back to a network request. */
export function frozenPublication(b:FreezeBundle,oex:FrozenOex,check:()=>Promise<void>):PublicResponse{
 const id=b.manifest.id,revision=b.manifest.source.exhibitionHash;
 const fetcher:typeof fetch=async(input,init)=>{
  init?.signal?.throwIfAborted();await check();const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  const asset=[...oex.assets].find(([assetId])=>url===`/api/v1/publications/${id}/assets/${assetId}`);
  if(!asset||init?.method&&init.method!=='GET')throw Error('OFFLINE_ASSET_URL');
  const [assetId,data]=asset;const inventory=[...oex.exhibition.artworks.flatMap(a=>a.assets),...oex.exhibition.mediaAssets].find(a=>a.id===assetId);
  if(!inventory||data.bytes.length!==inventory.bytes||await freezeHash(data.bytes)!==inventory.sha256)throw Error('OFFLINE_ASSET_INTEGRITY');
  await check();init?.signal?.throwIfAborted();return new Response(new Uint8Array(data.bytes),{headers:{'content-type':data.mime,'content-length':String(data.bytes.length),'x-exhibitos-publication-revision':revision}});
 };
 return {publication:{id,revisionSha256:revision,publishedAt:b.manifest.createdAt,status:'published'},exhibition:oex.exhibition,assets:[...oex.assets].map(([assetId,data])=>({assetId,mime:data.mime,url:`/api/v1/publications/${id}/assets/${assetId}`})),local:{fetcher,check}};
}
export function OfflineExhibition(){
 const [authority,setAuthority]=useState<OfflineAuthority>(),[records,setRecords]=useState<FreezeRecord[]>([]),[active,setActive]=useState<{value:PublicResponse;deadline:string}|null>(null),[message,setMessage]=useState('온라인에서 신뢰할 표시 계정과 서명 키를 먼저 준비하세요.'),[busy,setBusy]=useState(false),[portable,setPortable]=useState(false),[validating,setValidating]=useState(false);
 const gate=useRef<Promise<void>|null>(null);
 const generation=useRef(0),activeCheck=useRef<(()=>Promise<void>)|null>(null);
 const close=(reason:string)=>{generation.current++;activeCheck.current=null;gate.current=null;setValidating(false);setActive(null);setMessage(reason);};
 useEffect(()=>{void readOfflineAuthority().then(async a=>{if(a){setAuthority(a);setPortable(!!a.portableMode);setRecords(await listFreezeRecords(authorityScope(a)));}}).catch(()=>setMessage('오프라인 저장소를 열 수 없습니다.'));return()=>{generation.current++;};},[]);
 useEffect(()=>{const changed=()=>{close('표시 계정이 변경되어 관람을 닫았습니다. 새 계정을 명시적으로 준비하세요.');setAuthority(undefined);setRecords([]);};window.addEventListener('exhibitos-auth-changed',changed);return()=>window.removeEventListener('exhibitos-auth-changed',changed);},[]);
 useEffect(()=>{if(!active)return;const timer=setTimeout(()=>close('오프라인 표시 기한이 끝나 관람을 중단했습니다. 원본 서버에서 갱신하세요.'),Math.max(0,Date.parse(active.deadline)-Date.now()));const check=(suspend=false)=>{if(gate.current||!activeCheck.current)return;if(suspend)setValidating(true);const promise=activeCheck.current();gate.current=promise;void promise.then(()=>{if(gate.current===promise){gate.current=null;setValidating(false);}}).catch(()=>{close('계정·권리·연결 또는 시계 검증에 실패하여 관람을 중단했습니다.');setAuthority(undefined);setRecords([]);});};const reconnect=()=>check(true);const visible=()=>{if(document.visibilityState==='visible')check(true);};window.addEventListener('online',reconnect);window.addEventListener('storage',reconnect);document.addEventListener('visibilitychange',visible);const poll=setInterval(()=>check(),10000);return()=>{clearTimeout(timer);clearInterval(poll);window.removeEventListener('online',reconnect);window.removeEventListener('storage',reconnect);document.removeEventListener('visibilitychange',visible);};},[active]);
 async function prepare(){setBusy(true);close('표시 계정을 확인합니다.');try{const a=await fetchOfflineAuthority(portable);await saveOfflineAuthority(a);setAuthority(a);setRecords(await listFreezeRecords(authorityScope(a)));setMessage('계정과 신뢰할 서명 키를 준비했습니다. 오프라인 전시 파일을 선택하세요.');}catch{setAuthority(undefined);setRecords([]);setMessage('계정 또는 신뢰할 서버 키를 확인할 수 없습니다. 원본 서버에 로그인하고 다시 준비하세요.');}finally{setBusy(false);}}
 async function importBytes(bytes:Uint8Array){if(!authority)throw Error('OFFLINE_NOT_PREPARED');if(bytes.length>MAX_FREEZE_BYTES)throw Error('OFFLINE_SIZE');const verified=await verifyFreezeBundle(bytes,{trustedKeys:[authority.authority.keyId]});const b=verified.bundle;matchOfflineAuthority(authority,b);await assertFreezeRuntime(b);await assertFreezeOnline(authority,b);const oex=await decodeFreezeOex(verified.oexBytes,b.manifest.source.exhibitionHash);if(!await observeOfflineTime())throw Error('OFFLINE_CLOCK');const record:FreezeRecord={key:freezeRecordKey(authority,b),scope:authorityScope(authority),freezeId:b.manifest.id,title:oex.exhibition.title,bytes:new Uint8Array(bytes),authority,expiresAt:b.authorization.grant.expiresAt,preparedAt:new Date().toISOString()};await addFreezeRecord(record);setRecords(await listFreezeRecords(record.scope));setMessage('서명·전체 파일·계정·현재 권리를 검사하고 별도 사본으로 저장했습니다.');}
 async function renew(record:FreezeRecord){
  setBusy(true);close('원본 서버에서 새 표시 기한을 요청합니다.');
  try{
   if(!authority||authority.portableMode||!navigator.onLine||record.scope!==authorityScope(authority))throw Error('OFFLINE_RENEW_CONNECTION');
   const verified=await verifyFreezeBundle(record.bytes,{trustedKeys:[authority.authority.keyId],preservationOnly:true});
   matchOfflineAuthority(authority,verified.bundle);await assertFreezeOnline(authority,verified.bundle);
   const session=await json(await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)})) as {tenantId?:string;userId?:string;csrfToken?:string};
   if(session.tenantId!==authority.tenantId||session.userId!==authority.subjectId||typeof session.csrfToken!=='string'||!session.csrfToken)throw Error('OFFLINE_PROFILE');
   const b=verified.bundle,path=`/api/v1/tenants/${authority.tenantId}/studio/exhibitions/${b.manifest.source.exhibitionId}/freezes/${b.manifest.id}/offline`;
   const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({seconds:3600})});
   await importBytes(await bounded(response,MAX_FREEZE_BYTES));
  }catch{setMessage('표시 기한을 갱신할 수 없습니다. 원본 서버에 로그인하고 현재 권리와 계정을 확인하세요. 기존 사본은 유지합니다.');}finally{setBusy(false);}
 }
 async function open(record:FreezeRecord){setBusy(true);close('고정 전시를 검증합니다.');const current=generation.current;try{if(!authority||record.scope!==authorityScope(authority))throw Error('OFFLINE_PROFILE');const verified=await verifyFreezeBundle(record.bytes,{trustedKeys:[authority.authority.keyId]});const b=verified.bundle;matchOfflineAuthority(authority,b);await assertFreezeRuntime(b);await assertFreezeOnline(authority,b);const oex=await decodeFreezeOex(verified.oexBytes,b.manifest.source.exhibitionHash);const deadline=b.authorization.grant.expiresAt;
  const check=async()=>{if(generation.current!==current||Date.now()>=Date.parse(deadline)||!await observeOfflineTime())throw Error('OFFLINE_EXPIRED');};await check();activeCheck.current=async()=>{await check();await assertFreezeOnline(authority,b);await check();};if(generation.current===current)setActive({value:frozenPublication(b,oex,async()=>{await gate.current;await check();}),deadline});setMessage('고정 전시를 열었습니다.');
 }catch{close('서명·계정·현재 권리·기한·시계 또는 runtime이 맞지 않아 전시를 열지 않았습니다. 기존 사본은 유지합니다.');}finally{setBusy(false);}}
 return <section className="cms-shell" aria-label="고정 전시·오프라인"><h1>고정 전시·오프라인</h1><p>서명된 고정 전시의 글·목록부터 관람합니다. 연결이 끊긴 동안 권리 철회를 즉시 확인할 수 없으며 서명된 표시 기한까지 사용할 수 있습니다. 새 기한은 원본 서버에서 파일을 다시 받아 명시적으로 준비해야 합니다.</p>
 <p role="status">{message}</p><label><input type="checkbox" checked={portable} disabled={busy||!!active} onChange={e=>{setPortable(e.target.checked);setAuthority(undefined);setRecords([]);}}/>운영자가 신뢰 키를 확인한 로컬 오프라인 서버</label><button disabled={busy} onClick={()=>void prepare()}>표시 계정 및 신뢰 키 준비</button>
 <label>오프라인 전시 파일<input aria-label="오프라인 전시 파일" type="file" accept=".oef,application/json" disabled={!authority||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>MAX_FREEZE_BYTES){setMessage('파일 크기 한도를 초과했습니다.');return;}setBusy(true);void file.arrayBuffer().then(b=>importBytes(new Uint8Array(b))).catch(()=>setMessage('서명·파일·권리·버전 또는 저장 공간 검사에 실패했습니다. 기존 사본은 유지합니다.')).finally(()=>setBusy(false));}}/></label>
 {portable&&<button disabled={!authority||busy} onClick={()=>{setBusy(true);void fetch('/offline-package',{cache:'no-store',credentials:'omit'}).then(r=>bounded(r,MAX_FREEZE_BYTES)).then(importBytes).catch(()=>setMessage('로컬 패키지를 검증 또는 저장할 수 없습니다. 기존 사본은 유지합니다.')).finally(()=>setBusy(false));}}>로컬 서명 패키지 준비</button>}
 <ul>{records.map(r=><li key={r.key}>{r.title} · 표시 기한 {r.expiresAt}<button disabled={busy} onClick={()=>void open(r)}>고정 전시 열기</button>{!authority?.portableMode&&<button disabled={busy} onClick={()=>void renew(r)}>원본 서버에서 표시 기한 갱신</button>}</li>)}</ul>
 {active&&<><p>표시 기한 <time>{active.deadline}</time></p><button onClick={()=>close('관람을 닫았습니다. 저장된 원본 사본은 유지합니다.')}>오프라인 관람 닫기</button>{validating ? <p role="status">현재 계정과 권리를 다시 확인하는 동안 관람을 멈춥니다.</p> : <PublicPublication id={active.value.publication.id} initial={active.value}/>}</>}
 </section>;
}
