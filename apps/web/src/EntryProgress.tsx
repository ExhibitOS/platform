// SPDX-License-Identifier: AGPL-3.0-or-later
import type {RefObject} from 'react';
import './EntryProgress.css';

export type EntryDownloadProgress = Readonly<{
  receivedBytes: number;
  requiredBytes: number | null;
}>;

export function EntryProgress({download,statusRef}:{
  download?: EntryDownloadProgress | null;
  statusRef?: RefObject<HTMLParagraphElement | null>;
}) {
  // The static owner supplies a denominator only after its exact plan is known.
  // An unknown plan still needs honest feedback after Enter, not a made-up total.
  const required = download?.requiredBytes;
  const received = download?.receivedBytes;
  const downloading = typeof required === 'number' && Number.isSafeInteger(required) && required > 0 &&
    typeof received === 'number' && Number.isSafeInteger(received) && received >= 0 && received < required;
  return <div className="entry-progress">
    <p ref={statusRef} tabIndex={-1} className="publication-entry-progress" role="status">
      {downloading ? '전시장에 필요한 파일을 받고 있어요.' : '전시장 준비 중'}
    </p>
    {downloading && <progress className="entry-progress-gauge"
      aria-label="전시장 입장 파일 받는 중" max={required} value={received}/>}
  </div>;
}
