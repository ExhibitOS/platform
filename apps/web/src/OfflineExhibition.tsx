// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useRef,useState} from 'react';
import {MAX_FREEZE_BYTES,verifyFreezeBundle,freezeCanonical,type FreezeBundle} from '@exhibitos/studio-contract';
import {PublicPublication} from './PublicPublication';
import {prepareStudioShell} from './studio-shell';
import type {PublicPublication as PublicResponse} from './publication-client';
import {decodeFreezeOex,freezeHash,type FrozenOex} from './freeze-oex';
import {addFreezeRecord,authorityScope,freezeRecordKey,listFreezeRecords,observeOfflineTime,readOfflineAuthority,saveOfflineAuthority,clearOfflineAuthority,offlineOperation,type OfflineOperation,type FreezeRecord,type OfflineAuthority} from './freeze-cache';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function bounded(response:Response,limit:number){if(!response.ok||!response.body)throw Error('OFFLINE_RESPONSE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('OFFLINE_SIZE');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return bytes;}
async function json(response:Response){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,1048576))) as unknown;}
export async function fetchOfflineAuthority(portable=false):Promise<OfflineAuthority>{
 const raw=await json(await fetch(portable?'/offline-authority':'/api/v1/freeze/authority',{credentials:portable?'omit':'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)}));
 if(!raw||typeof raw!=='object')throw Error('OFFLINE_AUTHORITY');const a=raw as OfflineAuthority;
 if(!a.authority||typeof a.authority.publicKey!=='string'||!/^[a-f0-9]{64}$/.test(a.authority.keyId)||!uuid.test(a.tenantId)||!uuid.test(a.subjectId)||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now()||(!portable&&a.authority.origin!==location.origin)||(portable&&a.portableMode!==true))throw Error('OFFLINE_AUTHORITY');
 return a;
}
/** The asynchronous preparation never saves or returns a profile after its account generation changes. */
export async function prepareOfflineProfile(portable:boolean,operation:OfflineOperation){
 const authority=await operation.wait(fetchOfflineAuthority(portable));
 operation.assert();await operation.wait(saveOfflineAuthority(authority,operation.assert));
 const records=await operation.wait(listFreezeRecords(authorityScope(authority)));
 return {authority,records};
}
export async function stageFreezeRecord(record:FreezeRecord,operation:OfflineOperation){
 operation.assert();await operation.wait(addFreezeRecord(record,operation.assert));
 return operation.wait(listFreezeRecords(record.scope));
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
 const [authority,setAuthority]=useState<OfflineAuthority>(),[records,setRecords]=useState<FreezeRecord[]>([]),[active,setActive]=useState<{value:PublicResponse;deadline:string}|null>(null),[message,setMessage]=useState('온라인에서 신뢰할 표시 계정과 서명 키를 먼저 준비하세요.'),[busy,setBusy]=useState(false),[portable,setPortable]=useState(false),[validating,setValidating]=useState(false),[shell,setShell]=useState('오프라인 앱 재시작을 준비하지 않았습니다.'),[shellWaiting,setShellWaiting]=useState(false);
 const shellCleanup=useRef<(()=>void)|null>(null),shellGeneration=useRef(0);
 const gate=useRef<Promise<void>|null>(null);
 const generation=useRef(0),activeCheck=useRef<(()=>Promise<void>)|null>(null);
 const close=(reason:string)=>{generation.current++;activeCheck.current=null;gate.current=null;setValidating(false);setActive(null);setMessage(reason);};
 useEffect(()=>{const operation=offlineOperation(generation);void operation.wait(readOfflineAuthority()).then(async a=>{if(a){const cached=await operation.wait(listFreezeRecords(authorityScope(a)));operation.assert();setAuthority(a);setPortable(!!a.portableMode);setRecords(cached);}}).catch(()=>{if(operation.valid())setMessage('오프라인 저장소를 열 수 없습니다.');});return()=>{generation.current++;shellGeneration.current++;shellCleanup.current?.();};},[]);
 useEffect(()=>{const changed=()=>{close('표시 계정이 변경되어 관람을 닫았습니다. 새 계정을 명시적으로 준비하세요.');setAuthority(undefined);setRecords([]);setBusy(false);void clearOfflineAuthority().catch(()=>{});};window.addEventListener('exhibitos-auth-changed',changed);return()=>window.removeEventListener('exhibitos-auth-changed',changed);},[]);
 useEffect(()=>{if(!active)return;const timer=setTimeout(()=>close('오프라인 표시 기한이 끝나 관람을 중단했습니다. 원본 서버에서 갱신하세요.'),Math.max(0,Date.parse(active.deadline)-Date.now()));const check=(suspend=false)=>{if(gate.current||!activeCheck.current)return;if(suspend)setValidating(true);const promise=activeCheck.current();gate.current=promise;void promise.then(()=>{if(gate.current===promise){gate.current=null;setValidating(false);}}).catch(()=>{if(gate.current!==promise)return;close('계정·권리·연결 또는 시계 검증에 실패하여 관람을 중단했습니다.');setAuthority(undefined);setRecords([]);void clearOfflineAuthority().catch(()=>{});});};const reconnect=()=>check(true);const visible=()=>{if(document.visibilityState==='visible')check(true);};window.addEventListener('online',reconnect);window.addEventListener('storage',reconnect);document.addEventListener('visibilitychange',visible);const poll=setInterval(()=>check(),10000);return()=>{clearTimeout(timer);clearInterval(poll);window.removeEventListener('online',reconnect);window.removeEventListener('storage',reconnect);document.removeEventListener('visibilitychange',visible);};},[active]);
 async function prepare(){setBusy(true);close('표시 계정을 확인합니다.');const operation=offlineOperation(generation);try{shellCleanup.current?.();const shellEpoch=++shellGeneration.current;const cleanup=await prepareStudioShell(value=>{if(shellGeneration.current===shellEpoch)setShell(value.replace('/studio','/offline'));},registration=>{if(shellGeneration.current===shellEpoch)setShellWaiting(!!registration);});if(!operation.valid()){cleanup();return;}shellCleanup.current=cleanup;const result=await prepareOfflineProfile(portable,operation);operation.assert();setAuthority(result.authority);setRecords(result.records);setMessage('계정과 신뢰할 서명 키를 준비했습니다. 오프라인 전시 파일을 선택하세요.');}catch{if(operation.valid()){setAuthority(undefined);setRecords([]);setMessage('계정 또는 신뢰할 서버 키를 확인할 수 없습니다. 원본 서버에 로그인하고 다시 준비하세요.');}}finally{if(operation.valid())setBusy(false);}}
 async function importBytes(bytes:Uint8Array,a:OfflineAuthority,operation:OfflineOperation){
  operation.assert();if(bytes.length>MAX_FREEZE_BYTES)throw Error('OFFLINE_SIZE');
  const verified=await operation.wait(verifyFreezeBundle(bytes,{trustedKeys:[a.authority.keyId]}));const b=verified.bundle;matchOfflineAuthority(a,b);
  await operation.wait(assertFreezeRuntime(b));await operation.wait(assertFreezeOnline(a,b));
  const oex=await operation.wait(decodeFreezeOex(verified.oexBytes,b.manifest.source.exhibitionHash));if(!await operation.wait(observeOfflineTime()))throw Error('OFFLINE_CLOCK');
  const record:FreezeRecord={key:freezeRecordKey(a,b),scope:authorityScope(a),freezeId:b.manifest.id,title:oex.exhibition.title,bytes:new Uint8Array(bytes),authority:a,expiresAt:b.authorization.grant.expiresAt,preparedAt:new Date().toISOString()};
  const cached=await stageFreezeRecord(record,operation);operation.assert();setRecords(cached);setMessage('서명·전체 파일·계정·현재 권리를 검사하고 별도 사본으로 저장했습니다.');
 }
 async function importFile(file:File){if(!authority)return;const a=authority;setBusy(true);close('오프라인 파일을 검증합니다.');const operation=offlineOperation(generation);try{const bytes=await operation.wait(file.arrayBuffer());await importBytes(new Uint8Array(bytes),a,operation);}catch{if(operation.valid())setMessage('서명·파일·권리·버전 또는 저장 공간 검사에 실패했습니다. 기존 사본은 유지합니다.');}finally{if(operation.valid())setBusy(false);}}
 async function importPortable(){if(!authority)return;const a=authority;setBusy(true);close('로컬 패키지를 검증합니다.');const operation=offlineOperation(generation);try{const response=await operation.wait(fetch('/offline-package',{cache:'no-store',credentials:'omit'}));await importBytes(await operation.wait(bounded(response,MAX_FREEZE_BYTES)),a,operation);}catch{if(operation.valid())setMessage('로컬 패키지를 검증 또는 저장할 수 없습니다. 기존 사본은 유지합니다.');}finally{if(operation.valid())setBusy(false);}}
 async function renew(record:FreezeRecord){
  setBusy(true);close('원본 서버에서 새 표시 기한을 요청합니다.');const operation=offlineOperation(generation);
  try{
   if(!authority||authority.portableMode||!navigator.onLine||record.scope!==authorityScope(authority))throw Error('OFFLINE_RENEW_CONNECTION');
   const verified=await operation.wait(verifyFreezeBundle(record.bytes,{trustedKeys:[authority.authority.keyId],preservationOnly:true}));
   matchOfflineAuthority(authority,verified.bundle);await operation.wait(assertFreezeOnline(authority,verified.bundle));
   const session=await operation.wait(json(await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)}))) as {tenantId?:string;userId?:string;csrfToken?:string};
   if(session.tenantId!==authority.tenantId||session.userId!==authority.subjectId||typeof session.csrfToken!=='string'||!session.csrfToken)throw Error('OFFLINE_PROFILE');
   const b=verified.bundle,path=`/api/v1/tenants/${authority.tenantId}/studio/exhibitions/${b.manifest.source.exhibitionId}/freezes/${b.manifest.id}/offline`;
   operation.assert();const response=await operation.wait(fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({seconds:3600})}));
   await importBytes(await operation.wait(bounded(response,MAX_FREEZE_BYTES)),authority,operation);
  }catch{if(operation.valid())setMessage('표시 기한을 갱신할 수 없습니다. 원본 서버에 로그인하고 현재 권리와 계정을 확인하세요. 기존 사본은 유지합니다.');}finally{if(operation.valid())setBusy(false);}
 }
 async function open(record:FreezeRecord){setBusy(true);close('고정 전시를 검증합니다.');const operation=offlineOperation(generation);try{
  if(!authority||record.scope!==authorityScope(authority))throw Error('OFFLINE_PROFILE');
  const verified=await operation.wait(verifyFreezeBundle(record.bytes,{trustedKeys:[authority.authority.keyId]}));const b=verified.bundle;matchOfflineAuthority(authority,b);
  await operation.wait(assertFreezeRuntime(b));await operation.wait(assertFreezeOnline(authority,b));
  const oex=await operation.wait(decodeFreezeOex(verified.oexBytes,b.manifest.source.exhibitionHash)),deadline=b.authorization.grant.expiresAt;
  const check=async()=>{operation.assert();if(Date.now()>=Date.parse(deadline)||!await operation.wait(observeOfflineTime()))throw Error('OFFLINE_EXPIRED');};
  await operation.wait(check());operation.assert();activeCheck.current=async()=>{await check();await assertFreezeOnline(authority,b);await check();};
  setActive({value:frozenPublication(b,oex,async()=>{await gate.current;await check();}),deadline});setMessage('고정 전시를 열었습니다.');
 }catch{if(operation.valid()){setBusy(false);close('서명·계정·현재 권리·기한·시계 또는 runtime이 맞지 않아 전시를 열지 않았습니다. 기존 사본은 유지합니다.');}}finally{if(operation.valid())setBusy(false);}
 }
 return <section className="cms-shell" aria-label="고정 전시·오프라인"><h1>고정 전시·오프라인</h1><p>서명된 고정 전시의 글·목록부터 관람합니다. 연결이 끊긴 동안 권리 철회를 즉시 확인할 수 없으며 서명된 표시 기한까지 사용할 수 있습니다. 새 기한은 원본 서버에서 파일을 다시 받아 명시적으로 준비해야 합니다.</p>
 <p role="status">{message}</p><p role="status" data-testid="offline-shell">{shell}</p>{shellWaiting&&<p role="status">새 runtime이 대기 중입니다. 자동으로 적용하지 않습니다. 표시 파일의 runtime과 현재 앱이 다르면 관람을 거부하며 보존된 runtime은 로컬 서버로 실행하세요.</p>}<label><input type="checkbox" checked={portable} disabled={busy||!!active} onChange={e=>{close('표시 모드를 변경했습니다. 신뢰 키를 다시 준비하세요.');setPortable(e.target.checked);setAuthority(undefined);setRecords([]);}}/>운영자가 신뢰 키를 확인한 로컬 오프라인 서버</label><button disabled={busy} onClick={()=>void prepare()}>표시 계정 및 신뢰 키 준비</button>
 <label>오프라인 전시 파일<input aria-label="오프라인 전시 파일" type="file" accept=".oef,application/json" disabled={!authority||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>MAX_FREEZE_BYTES){setMessage('파일 크기 한도를 초과했습니다.');return;}void importFile(file);}}/></label>
 {portable&&<button disabled={!authority||busy} onClick={()=>void importPortable()}>로컬 서명 패키지 준비</button>}
 <ul>{records.map(r=><li key={r.key}>{r.title} · 표시 기한 {r.expiresAt}<button disabled={busy} onClick={()=>void open(r)}>고정 전시 열기</button>{!authority?.portableMode&&<button disabled={busy} onClick={()=>void renew(r)}>원본 서버에서 표시 기한 갱신</button>}</li>)}</ul>
 {active&&<><p>표시 기한 <time>{active.deadline}</time></p><button onClick={()=>close('관람을 닫았습니다. 저장된 원본 사본은 유지합니다.')}>오프라인 관람 닫기</button>{validating ? <p role="status">현재 계정과 권리를 다시 확인하는 동안 관람을 멈춥니다.</p> : <PublicPublication id={active.value.publication.id} initial={active.value}/>}</>}
 </section>;
}
