// SPDX-License-Identifier: AGPL-3.0-or-later
import {publicationTime} from '../publication-time';
import type {RuntimeHistory} from './runtime-history';

function HistoryTime({label,value}:{label:string;value:string|null}) {
 const time=publicationTime(value);
 return <p>{label} {time.dateTime?<time dateTime={time.dateTime}>{time.text}</time>:'확인할 수 없음'}</p>;
}

/** Values are supplied by the verified runtime-history reader, never inferred here. */
export function RuntimeHistoryDetails({history}:{history:RuntimeHistory}) {
 return <>
  <p>Viewer 버전 {history.runtimeVersion??'확인할 수 없음'}</p>
  <p>Viewer 소스 버전 {history.sourceCommit?<code>{history.sourceCommit}</code>:'확인할 수 없음'}</p>
  <HistoryTime label="출력 생성 시각" value={history.outputGeneratedAt}/>
  <HistoryTime label="확인된 배포 시각" value={history.deployedAt}/>
 </>;
}
