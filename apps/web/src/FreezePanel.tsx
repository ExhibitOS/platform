import {useEffect,useRef,useState} from 'react';
import type {FreezeSummary,FreezeBundle} from '@exhibitos/studio-contract';
import type {Session} from './cms-client';
import {failureMessage} from './cms-client';
import type {LocalDraft} from './drafts/store';
import {oexRequest} from './oex-client';

export function FreezePanel({session,record,dirty,disabled}:{session:Session|null;record:LocalDraft|null;dirty:boolean;disabled:boolean}){
 const [items,setItems]=useState<FreezeSummary[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const scope=`${session?.tenantId}:${session?.userId}:${session?.csrfToken}:${record?.remote?.id}`;
 const current=useRef({scope,generation:0});if(current.current.scope!==scope)current.current={scope,generation:current.current.generation+1};
 const generation=current.current.generation,active=()=>current.current.scope===scope&&current.current.generation===generation;
 useEffect(()=>{setItems([]);setMessage('');setBusy(false);},[scope]);
 const connected=!!session&&record?.remote?.tenantId===session.tenantId&&record.remote.userId===session.userId;
 const allowed=connected&&!!session&&['artist','admin'].includes(session.role);
 const path=session&&record?.remote?`/api/v1/tenants/${session.tenantId}/studio/exhibitions/${record.remote.id}/freezes`:'';
 async function refresh(){if(!session||!connected)return;const result=await oexRequest<{items:FreezeSummary[]}>(path,session);if(active())setItems(result.items);}
 async function work(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn();}catch(error){if(active())setMessage(failureMessage(error));}finally{if(active())setBusy(false);}}
 async function create(){if(!session||!record?.remote||!allowed||dirty)return;await oexRequest(path,session,'POST',{requestId:crypto.randomUUID()},record.remote.etag);if(active()){await refresh();setMessage('서버 저장본과 실행 파일을 새 고정 버전으로 보존했습니다.');}}
 async function download(item:FreezeSummary){if(!session||!allowed)return;const bundle=await oexRequest<FreezeBundle>(`${path}/${item.id}/offline`,session,'POST',{seconds:3600});if(!active())return;const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${item.id}.oef`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(`오프라인 사본 표시 기한: ${bundle.authorization.grant.expiresAt}`);}
 return <section className="cms-panel" aria-label="전시 버전 고정"><h2>전시 버전 고정</h2><p>서버에 저장된 전시·작품 파일·실행 코드를 별도 버전으로 보존합니다. 이후 편집은 이전 버전을 바꾸지 않습니다. 현재 승인과 표시·내보내기 권리가 모두 유효해야 합니다.</p><p>오프라인 사본은 최대 한 시간이며 계정이나 작품 권리 기한이 더 빠르면 그때 끝납니다. 연결이 끊기면 새 철회를 즉시 확인할 수 없습니다. 기한 후 원본 서버에서 새 사본을 받아야 합니다.</p><p role="status">{message}</p><button disabled={disabled||busy||!allowed||dirty} onClick={()=>void work(create)}>저장본을 새 고정 버전으로 보존</button><button disabled={disabled||busy||!connected} onClick={()=>void work(refresh)}>고정 버전 목록 새로고침</button><a href="/offline">오프라인 전시 준비·관람</a><ul>{items.map(item=><li key={item.id}>서버 revision {item.manifest.source.revision} · {item.createdAt} · {item.status}<button disabled={busy||!allowed||item.status!=='available'} onClick={()=>void work(()=>download(item))}>오프라인 사본 다운로드</button><button disabled={busy||!connected} onClick={()=>void work(async()=>{if(!session)return;const result=await oexRequest<FreezeSummary&{comparison:{latestDraftRevision:number;sceneChanged:boolean}}>(`${path}/${item.id}`,session);if(active())setMessage(`현재 서버 revision ${result.comparison.latestDraftRevision} · 고정본과 ${result.comparison.sceneChanged?'다름':'같음'}`);})}>현재 저장본과 비교</button><button disabled={busy||!allowed} onClick={()=>void work(async()=>{if(!session)return;await oexRequest(`${path}/${item.id}/${item.status==='revoked'?'restore':'revoke'}`,session,'POST',{});if(active())await refresh();})}>{item.status==='revoked'?'고정본 표시 복원':'고정본 표시 철회'}</button></li>)}</ul></section>;
}
