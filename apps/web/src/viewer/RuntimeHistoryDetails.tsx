// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useState} from 'react';
import {publicationTime} from '../publication-time';
import {resolveConfirmedDeployment} from './runtime-history';
import type {RuntimeHistory} from './runtime-history';

function HistoryTime({label,value}:{label:string;value:string|null}) {
 const time=publicationTime(value);
 return <p>{label} {time.dateTime?<time dateTime={time.dateTime}>{time.text}</time>:'확인할 수 없음'}</p>;
}

type ActiveHistory={indexSha256:string;publicationId:string;revisionSha256:string};
type DeploymentResult={key:string;value:string|null};
export const historyIsOpen=(menu:boolean,info:boolean,history:boolean)=>menu&&info&&history;
export const historyKey=(active:ActiveHistory)=>JSON.stringify([active.indexSha256,active.publicationId,active.revisionSha256]);
export function visibleDeployment(open:boolean,active:ActiveHistory|undefined,result:DeploymentResult|null):string|null {
 return open&&active&&result?.key===historyKey(active)?result.value:null;
}
export function startDeploymentLookup(resolve:(signal:AbortSignal)=>Promise<string|null>,accept:(value:string|null)=>void):()=>void {
 const controller=new AbortController();
 void resolve(controller.signal).then(value=>{if(!controller.signal.aborted)accept(value);}).catch(()=>{if(!controller.signal.aborted)accept(null);});
 return ()=>controller.abort();
}

/** Values are supplied by the verified runtime-history reader, never inferred here. */
export function RuntimeHistoryDetails({history,open=false,active}:{history:RuntimeHistory;open?:boolean;active?:ActiveHistory}) {
 const [deployment,setDeployment]=useState<DeploymentResult|null>(null);
 const indexSha256=active?.indexSha256,publicationId=active?.publicationId,revisionSha256=active?.revisionSha256;
 useEffect(()=>{
  if(!open||!indexSha256||!publicationId||!revisionSha256){setDeployment(null);return;}
  const current={indexSha256,publicationId,revisionSha256};
  setDeployment(null);
  return startDeploymentLookup(signal=>resolveConfirmedDeployment(document,current,signal),value=>setDeployment({key:historyKey(current),value}));
 },[open,indexSha256,publicationId,revisionSha256]);
 return <>
  <p>Viewer 버전 {history.runtimeVersion??'확인할 수 없음'}</p>
  <p>Viewer 소스 버전 {history.sourceCommit?<code>{history.sourceCommit}</code>:'확인할 수 없음'}</p>
  <p>Viewer 빌드 식별자 {history.buildId?<code>{history.buildId}</code>:'확인할 수 없음'}</p>
  <HistoryTime label="출력 생성 시각" value={history.outputGeneratedAt}/>
  <HistoryTime label="확인된 배포 시각" value={visibleDeployment(open,active,deployment)}/>
 </>;
}
