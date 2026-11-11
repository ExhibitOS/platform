// SPDX-License-Identifier: AGPL-3.0-or-later
import {useId} from 'react';
import type {DetailTier} from '@exhibitos/studio-contract';
import type {DetailQualityProgress} from './viewer/borrowed-detail-preview';

export const detailQualityLevel:Record<DetailTier,number>={'lightweight':1,'approved-full':2,'acquired-original':3};
export function detailQualityName(tier:DetailTier,flat:boolean){
  if(tier==='acquired-original')return '원본 파일';
  if(tier==='approved-full')return '승인된 고화질';
  return flat?'경량 이미지':'경량 모델';
}

/** The glyph describes a committed draw. The surrounding arc describes only transfer bytes. */
export function DetailQualityControl({tier,flat,progress}:{tier:DetailTier;flat:boolean;progress:DetailQualityProgress|null}){
  const statusId=useId(),name=detailQualityName(tier,flat);
  const pending=progress&&detailQualityLevel[progress.tier]>detailQualityLevel[tier]?progress:null;
  const total=pending?.totalBytes,received=pending?.loadedBytes;
  const downloading=typeof total==='number'&&Number.isSafeInteger(total)&&total>0&&
    typeof received==='number'&&Number.isSafeInteger(received)&&received>=0&&received<total;
  const transferred=!!pending&&total!==null&&received===total;
  const next=pending?detailQualityName(pending.tier,flat):null;
  const message=next?(downloading?`${next} 파일 받는 중`:transferred?`${next} 표시 준비 중`:`${next} 준비 중`):null;
  return <div className="detail-quality-control" data-progress-state={pending?(downloading?'download':'preparing'):undefined}>
    <details className="detail-help detail-quality">
      <summary className="detail-control-icon" aria-label={`현재 표시 품질: ${name}`}
        aria-describedby={message?statusId:undefined} title={`현재 표시 품질: ${name}`}>
        {pending&&<svg className="detail-quality-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false" fill="none">
          <circle className="detail-quality-ring-track" cx="22" cy="22" r="17"/>
          {downloading&&<circle className="detail-quality-ring-value" cx="22" cy="22" r="17" pathLength="1"
            strokeDasharray="1" strokeDashoffset={1-received/total} transform="rotate(-90 22 22)"/>}
          {!downloading&&!transferred&&<circle className="detail-quality-ring-pending" cx="22" cy="22" r="17"
            pathLength="1" strokeDasharray=".2 .8" transform="rotate(-90 22 22)"/>}
        </svg>}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M5 19v-4"/>
          <path d="M12 19v-9" opacity={detailQualityLevel[tier]>=2?1:.3}/>
          <path d="M19 19V5" opacity={detailQualityLevel[tier]>=3?1:.3}/>
        </svg>
      </summary>
      <p>현재 표시: {name}{message&&<><br/>{message}</>}</p>
    </details>
    {message&&<span id={statusId} className="detail-quality-accessible-status" role="status">{message}</span>}
    {pending&&!transferred&&<progress className="detail-quality-accessible-progress" aria-label={message!}
      max={downloading?total:undefined} value={downloading?received:undefined}/>}
  </div>;
}
