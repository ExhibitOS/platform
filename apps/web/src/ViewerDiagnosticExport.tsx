// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { createDiagnosticReport } from "./viewer/diagnostic-report";
import { diagnosticsEnabled, readDiagnosticSnapshot } from "./viewer/diagnostic-source";

const downloadName = "exhibitos-viewer-diagnostic.json";

export function ViewerDiagnosticExport() {
  return diagnosticsEnabled() ? <DiagnosticDownload /> : null;
}

function DiagnosticDownload() {
  const [status, setStatus] = useState("");
  const pending = useRef<{ url: string; timer: number } | null>(null);

  const clearDownload = useCallback(() => {
    if (!pending.current) return;
    window.clearTimeout(pending.current.timer);
    URL.revokeObjectURL(pending.current.url);
    pending.current = null;
  }, []);

  useEffect(() => clearDownload, [clearDownload]);

  function download() {
    try {
      const report = createDiagnosticReport(readDiagnosticSnapshot());
      clearDownload();
      const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
      pending.current = { url, timer: window.setTimeout(clearDownload, 30_000) };
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setStatus("진단 파일 다운로드를 요청했어요.");
    } catch {
      clearDownload();
      setStatus("진단 파일을 만들지 못했어요. 다시 시도해 주세요.");
    }
  }

  return (
    <details className="publication-accessibility-menu">
      <summary>스테이징 진단</summary>
      <p>현재 관람 상태와 최근 로딩 기록을 이 기기에 JSON 파일로 저장해요.</p>
      <button type="button" onClick={download}>진단 JSON 저장</button>
      <p role="status">{status}</p>
    </details>
  );
}
