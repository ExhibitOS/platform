import { useEffect, useRef, useState } from "react";
import type { Session } from "./cms-client";
import { failureMessage } from "./cms-client";
import {
  ready,
  publications,
  publish,
  unpublish,
  republish,
} from "./publication-client";
import type { Publication, ReadyReport } from "./publication-client";
import type { LocalDraft } from "./drafts/store";
export function PublicationPanel({
  record,
  session,
  disabled,
  dirty,
  onPublished,
  onFork,
}: {
  record: LocalDraft;
  session: Session | null;
  disabled: boolean;
  dirty: boolean;
  onPublished: (active: boolean) => void;
  onFork: () => void;
}) {
  const [report, setReport] = useState<ReadyReport | null>(null),
    [rows, setRows] = useState<Publication[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const attempt = useRef<{ etag: string; id: string } | null>(null);
  const scope = `${record.id}:${session?.tenantId ?? ""}:${session?.userId ?? ""}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const isCurrent = () => scopeRef.current === scope;
  const binding = record.remote,
    connected =
      !!session &&
      !!binding &&
      session.tenantId === binding.tenantId &&
      session.userId === binding.userId;
  useEffect(() => {
    setReport(null);
    attempt.current = null;
    setRows([]);
    setError("");
    setNotice("");
    setBusy(false);
    onPublished(false);
  }, [record.id, session?.userId, session?.tenantId]);
  useEffect(() => {
    setReport(null);
    attempt.current = null;
  }, [binding?.etag, record.version, dirty]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (isCurrent()) setError(failureMessage(e));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  async function refresh() {
    if (!session || !binding) return;
    const result = await publications(session, binding.id);
    if (!isCurrent()) return;
    setRows(result.items);
    onPublished(result.items.length > 0);
  }
  return (
    <fieldset disabled={disabled || busy} className="publication-panel">
      <legend>공개 preview·READY·Publication</legend>
      <p className="cms-note">
        먼저 현재 계정에 서버 draft를 저장하세요. READY는 저장된 revision의
        geometry·작품 승인·전시 권리·접근성을 검사합니다. 공개 URL은 승인된
        immutable snapshot만 제공합니다.
      </p>
      {!connected && (
        <p>
          현재 계정에 연결된 서버 draft가 필요합니다. 로컬 작업은 계속 사용할 수
          있습니다.
        </p>
      )}
      {dirty && (
        <p>현재 입력을 로컬 및 서버에 저장한 뒤 READY를 다시 검사하세요.</p>
      )}
      <p role="alert" data-testid="publication-error">
        {error}
      </p>
      <p aria-live="polite" data-testid="publication-status">
        {notice}
      </p>
      <div className="cms-actions">
        <button
          disabled={!connected || dirty}
          onClick={() =>
            void work(async () => {
              if (!session || !binding) return;
              const value = await ready(session, binding.id);
              setReport(value);
              setNotice(
                value.status === "READY"
                  ? "저장된 서버 revision이 READY 검사를 통과했습니다."
                  : "공개 전에 실패 항목을 수정하고 서버에 저장하세요.",
              );
              await refresh();
            })
          }
        >
          서버 revision READY 검사
        </button>
        <button disabled={!connected} onClick={() => void work(refresh)}>
          Publication 상태 다시 읽기
        </button>
      </div>
      {report && (
        <section aria-label="READY 검사 결과">
          <h3 data-testid="ready-state">{report.status}</h3>
          <p>
            검사한 서버 ETag <code>{report.etag}</code>
          </p>
          <ul>
            {report.issues.map((issue, i) => (
              <li key={`${issue.code}:${i}`}>
                <strong>{issue.code}</strong> <code>{issue.path}</code>
                <p>{issue.message}</p>
                <p>수정 안내: {issue.remediation}</p>
              </li>
            ))}
          </ul>
          <button
            disabled={
              !connected ||
              dirty ||
              report.status !== "READY" ||
              report.etag !== binding?.etag
            }
            onClick={() =>
              void work(async () => {
                if (!session || !binding) return;
                if (!attempt.current || attempt.current.etag !== report.etag)
                  attempt.current = {
                    etag: report.etag,
                    id: crypto.randomUUID(),
                  };
                const value = await publish(
                  session,
                  binding.id,
                  report.etag,
                  attempt.current.id,
                );
                if (!isCurrent()) return;
                setRows((previous) => [
                  value,
                  ...previous.filter(
                    (row) => row.publicationId !== value.publicationId,
                  ),
                ]);
                setReport(null);
                attempt.current = null;
                onPublished(true);
                setNotice(
                  "검사한 revision을 immutable Publication으로 공개했습니다. 수정하려면 새 draft를 만드세요.",
                );
              })
            }
          >
            READY revision 공개
          </button>
        </section>
      )}
      <ul className="publication-list">
        {rows.map((row) => (
          <li key={row.publicationId}>
            <span>
              {row.status} · {row.publishedAt}
            </span>
            <br />
            <code>{row.revisionSha256}</code>
            <br />
            {row.status === "published" && (
              <>
                <a href={row.publicUrl} target="_blank" rel="noreferrer">
                  익명 공개 preview 열기
                </a>
                <button
                  onClick={() =>
                    void work(async () => {
                      if (!session) return;
                      await unpublish(session, row.publicationId);
                      await refresh();
                      if (!isCurrent()) return;
                      setNotice(
                        "Publication을 철회했습니다. 이후 공개 metadata와 derivative 요청은 거부되며 기록은 audit에 남습니다. 수정하려면 새 draft를 만드세요.",
                      );
                    })
                  }
                >
                  Publication 철회
                </button>
              </>
            )}
            {row.status === "unpublished" && (
              <button
                onClick={() =>
                  void work(async () => {
                    if (!session) return;
                    await republish(session, row.publicationId);
                    await refresh();
                    if (!isCurrent()) return;
                    setNotice(
                      "현재 권리·승인 상태를 확인하고 동일한 immutable Publication을 다시 공개했습니다.",
                    );
                  })
                }
              >
                기존 Publication 다시 공개
              </button>
            )}
          </li>
        ))}
      </ul>
      <button disabled={!rows.length} onClick={onFork}>
        공개 revision에서 새 로컬 draft
      </button>
      <p className="cms-note">
        공개된 snapshot은 변경되지 않습니다. 새 draft를 별도로 편집하고
        저장·검사·공개하세요. 이미 브라우저에 전달된 작품 bytes를 원격 삭제하는
        DRM은 제공하지 않습니다.
      </p>
    </fieldset>
  );
}
