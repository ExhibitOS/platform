// SPDX-License-Identifier: AGPL-3.0-or-later
import type {RefObject} from 'react';

export type EntryDownloadProgress = Readonly<{
  receivedBytes: number;
  requiredBytes: number | null;
}>;

export function EntryProgress({download,statusRef}:{
  download?: EntryDownloadProgress | null;
  statusRef?: RefObject<HTMLParagraphElement | null>;
}) {
  // The static owner supplies a denominator only after its exact plan is known.
  if (download === null) return null;
  const required = download?.requiredBytes;
  const received = download?.receivedBytes;
  const downloading = typeof required === 'number' && Number.isSafeInteger(required) && required > 0 &&
    typeof received === 'number' && Number.isSafeInteger(received) && received >= 0 && received < required;
  const percent = downloading ? Math.min(99, Math.floor(received / required * 100)) : undefined;
  return <p ref={statusRef} tabIndex={-1} className="publication-entry-progress"
    role={downloading ? 'progressbar' : 'status'}
    aria-label={downloading ? '전시장 입장 파일 받는 중' : undefined}
    aria-valuemax={downloading ? 100 : undefined}
    aria-valuenow={percent}>
    {percent === undefined ? '전시장 준비 중' : `${percent}%`}
  </p>;
}
