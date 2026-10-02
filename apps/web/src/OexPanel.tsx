import { useEffect, useRef, useState } from 'react';
import type { Session } from './cms-client';
import { failureMessage } from './cms-client';
import type { LocalDraft } from './drafts/store';
import { exportOex, MAX_OEX_BYTES, oexPath, oexRequest } from './oex-client';
import type { OexJob, OexResult } from './oex-client';

export function OexPanel({session,record,dirty,disabled,onImported}:{session:Session|null;record:LocalDraft|null;dirty:boolean;disabled:boolean;onImported:(result:OexResult)=>Promise<void>}) {
  const [jobs,setJobs]=useState<OexJob[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const pending=useRef<{file:File;id:string;sha256:string;jobId?:string}|null>(null);
  const scope=`${session?.tenantId}:${session?.userId}:${session?.csrfToken}`;
  const current=useRef({scope,generation:0});
  if(current.current.scope!==scope)current.current={scope,generation:current.current.generation+1};
  const generation=current.current.generation;
  const active=()=>current.current.scope===scope&&current.current.generation===generation;
  useEffect(()=>{setJobs([]);setNotice('');setFile(null);pending.current=null;setBusy(false);},[scope]);
  const permitted=!!session&&['artist','admin'].includes(session.role);
  const connected=!!session&&record?.remote?.tenantId===session.tenantId&&record.remote.userId===session.userId;
  async function refresh(){if(!session)return;const value=await oexRequest<{items:OexJob[]}>(oexPath(session),session);if(active())setJobs(value.items);}
  async function work(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(error){if(active())setNotice(failureMessage(error));}finally{if(active())setBusy(false);}}
  async function upload(){
    if(!session||!file)return;
    if(file.size===0||file.size>MAX_OEX_BYTES)throw new Error('파일은 0바이트보다 크고 64MiB 이하여야 합니다.');
    const bytes=await file.arrayBuffer();if(!active())return;
    if(!pending.current||pending.current.file!==file){
      const digest=await crypto.subtle.digest('SHA-256',bytes);if(!active())return;
      pending.current={file,id:crypto.randomUUID(),sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
    }
    const attempt=pending.current;
    const job=await oexRequest<OexJob>(oexPath(session),session,'POST',{requestId:attempt.id,bytes:bytes.byteLength,sha256:attempt.sha256});
    if(!active())return;attempt.jobId=job.id;
    if(job.state==='received'||job.state==='uploading')await oexRequest<OexJob>(`${oexPath(session)}/${job.id}/bytes`,session,'PUT',bytes);
    if(!active())return;
    await oexRequest<OexJob>(`${oexPath(session)}/${job.id}/complete`,session,'POST',{});
    if(!active())return;
    await refresh();setNotice('파일을 전달했습니다. 검증이 끝나면 새 비공개 초안을 열 수 있습니다. 기존 전시는 유지됩니다.');
  }
  async function download(){
    if(!session||!record?.remote)return;
    const blob=await exportOex(session,record.remote.id,record.remote.etag);if(!active())return;
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`exhibition-${record.remote.id}.oex`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    setNotice('OEX 다운로드를 요청했습니다. 파일에는 서버 저장 revision과 내보내기 허용된 작품·오디오가 포함됩니다.');
  }
  return <fieldset disabled={disabled||busy} className="cms-card">
    <legend>전시 OEX 파일</legend>
    <p>작품·공간·동선·오디오를 한 파일로 옮깁니다. 가져오기는 현재 계정의 새 비공개 초안을 만들며 자동으로 공개하지 않습니다.</p>
    {!permitted&&<p>Artist CMS에서 artist 또는 admin 계정으로 로그인하면 사용할 수 있습니다.</p>}
    <button disabled={!permitted||!connected||dirty} onClick={()=>void work(download)}>OEX 내보내기</button>
    <p className="cms-note">내보내기 전에 현재 입력을 계정 서버에 저장하세요. 작품과 오디오의 내보내기 권한을 서버가 확인합니다. 로컬 JSON 백업과 OEX는 별도로 보관하세요.</p>
    <label>OEX 가져오기 파일<input type="file" accept=".oex,application/zip" disabled={!permitted} onChange={e=>{setFile(e.target.files?.[0]??null);pending.current=null;}} /></label>
    <div className="cms-actions"><button disabled={!permitted||!file} onClick={()=>void work(upload)}>파일 전달·가져오기 시작</button><button disabled={!permitted} onClick={()=>void work(refresh)}>가져오기 상태 새로고침</button></div>
    <p role="status" aria-label="OEX 처리 상태" aria-live="polite">{notice}</p>
    <ul className="cms-list">{jobs.map(job=><li key={job.id}><span>작업 {job.id} · {job.state}{job.errorCode?` · ${job.errorCode}`:''}</span>
      <div className="cms-actions">
        {job.state==='failed'&&<button onClick={()=>void work(async()=>{if(!session)return;await oexRequest(`${oexPath(session)}/${job.id}/retry`,session,'POST',{});await refresh();})}>가져오기 재시도</button>}
        {!['complete','cancelled'].includes(job.state)&&<button onClick={()=>void work(async()=>{if(!session)return;await oexRequest(`${oexPath(session)}/${job.id}/cancel`,session,'POST',{});await refresh();})}>가져오기 취소</button>}
        {job.state==='complete'&&<button disabled={dirty} onClick={()=>void work(async()=>{if(!session)return;const completed=await oexRequest<OexJob>(`${oexPath(session)}/${job.id}`,session);if(!active())return;if(completed.result){await onImported(completed.result);if(active())setNotice('가져온 전시를 새 로컬 사본으로 열었습니다. 공개하려면 별도로 READY 검사와 공개를 실행하세요.');}})}>가져온 전시 열기</button>}
      </div></li>)}</ul>
    {dirty&&<p>현재 미저장 입력을 보존하기 위해 전시 열기와 내보내기를 잠시 막았습니다. 먼저 로컬·서버 저장을 완료하세요.</p>}
  </fieldset>;
}
