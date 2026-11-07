// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useState} from 'react';
import {publicationTime} from '../publication-time';
import {resolveConfirmedDeployment} from './runtime-history';
import type {RuntimeHistory} from './runtime-history';

function HistoryTime({label,value}:{label:string;value:string|null}) {
 const time=publicationTime(value);
 return <p>{label} {time.dateTime?<time dateTime={time.dateTime}>{time.text}</time>:'확인할 수 없음'}</p>;
}

/** Values are supplied by the verified runtime-history reader, never inferred here. */
export function RuntimeHistoryDetails({history,open=false,active}:{history:RuntimeHistory;open?:boolean;active?:{indexSha256:string;publicationId:string;revisionSha256:string}}) {
 const [deployment,setDeployment]=useState<string|null>(history.deployedAt);
 const indexSha256=active?.indexSha256,publicationId=active?.publicationId,revisionSha256=active?.revisionSha256;
 useEffect(()=>{
  if(!open||!indexSha256||!publicationId||!revisionSha256){setDeployment(null);return;}
  const controller=new AbortController();
  setDeployment(null);
  void resolveConfirmedDeployment(document,{indexSha256,publicationId,revisionSha256},controller.signal).then(value=>{if(!controller.signal.aborted)setDeployment(value);}).catch(()=>{if(!controller.signal.aborted)setDeployment(null);});
  return ()=>controller.abort();
 },[open,indexSha256,publicationId,revisionSha256]);
 return <>
  <p>Viewer 버전 {history.runtimeVersion??'확인할 수 없음'}</p>
  <p>Viewer 소스 버전 {history.sourceCommit?<code>{history.sourceCommit}</code>:'확인할 수 없음'}</p>
  <p>Viewer 빌드 식별자 {history.buildId?<code>{history.buildId}</code>:'확인할 수 없음'}</p>
  <HistoryTime label="출력 생성 시각" value={history.outputGeneratedAt}/>
  <HistoryTime label="확인된 배포 시각" value={deployment}/>
 </>;
}
