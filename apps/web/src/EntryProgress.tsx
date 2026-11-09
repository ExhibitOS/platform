// SPDX-License-Identifier: AGPL-3.0-or-later
export type EntryDownloadProgress = Readonly<{
  receivedBytes: number;
  requiredBytes: number | null;
}>;

const phaseLabels = {
  space: "공간을 열고 있어요.",
  artwork: "첫 작품을 준비하고 있어요.",
  navigation: "안전한 관람을 준비하고 있어요.",
};

export function EntryProgress({active,phase,download,cover=false}:{
  active: boolean;
  phase: keyof typeof phaseLabels;
  download?: EntryDownloadProgress | null;
  cover?: boolean;
}) {
  const required = download?.requiredBytes;
  const received = download?.receivedBytes;
  const known = typeof required === "number" && Number.isSafeInteger(required) && required > 0 &&
    typeof received === "number" && Number.isSafeInteger(received) && received >= 0 && received <= required;
  const downloading = known && received < required;
  const percent = downloading ? Math.min(99, Math.floor(received / required * 100)) : undefined;
  const label = percent !== undefined
    ? `${percent}%`
    : cover
      ? known ? "입장에 필요한 파일을 받았어요." : "입장에 필요한 파일을 확인하고 있어요."
      : phaseLabels[phase];

  return <div className="publication-entry-meter-space">
    {active && <>
      {(!cover || !known || downloading) &&
        <div className="publication-entry-meter" role="progressbar" aria-label="전시장 입장 준비"
          aria-valuemin={downloading ? 0 : undefined}
          aria-valuemax={downloading ? 100 : undefined}
          aria-valuenow={percent}
          aria-valuetext={label} data-determinate={downloading || undefined}>
          <span aria-hidden="true" style={downloading ? {width:`${received / required * 100}%`} : undefined}/>
        </div>}
      <p className="publication-entry-phase" role={downloading ? undefined : "status"}>{label}</p>
    </>}
  </div>;
}
