import { useEffect, useMemo, useRef, useState } from "react";
import { DraftError, DraftStore } from "./drafts/store";
import type { Draft, LocalDraft, RemoteBinding } from "./drafts/store";
import { PublicationPanel } from "./PublicationPanel";
import { GeometryEditor } from "./GeometryEditor";
import { newDraft } from "./drafts/example";
import { validateDraft } from "./drafts/validator";
import { prepareStudioShell } from "./studio-shell";
import { failureMessage, request } from "./cms-client";
import type { Session } from "./cms-client";

interface Remote {
  revision: number;
  etag: string;
  draft: Draft;
}
class RemoteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const json = (value: unknown) => JSON.stringify(value, null, 2);
function download(text: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(error: unknown) {
  if (error instanceof DraftError)
    return (
      {
        INVALID_DRAFT:
          "전시 JSON의 구조·참조·단위가 유효하지 않습니다. 마지막 저장본은 유지되며 현재 입력은 자동으로 지우지 않습니다.",
        LOCAL_CONFLICT:
          "다른 탭이 이 draft를 먼저 저장했습니다. 현재 입력과 최신 저장본을 비교하고 새 사본을 만들 수 있습니다.",
        QUOTA:
          "브라우저 저장 공간이 부족합니다. 마지막 저장본은 유지됩니다. 현재 입력과 저장본을 파일로 백업하고 공간을 확보한 뒤 다시 저장하세요.",
        INTERRUPTED:
          "저장이 중단되었습니다. 마지막 완료된 저장본은 유지됩니다. 현재 입력을 백업하고 다시 저장하세요.",
        UNAVAILABLE:
          "브라우저 저장소에 접근할 수 없습니다. 다른 Studio 탭 또는 브라우저 정책을 확인하고 현재 입력을 파일로 백업하세요.",
        FUTURE_VERSION:
          "이 앱보다 새로운 형식의 기록입니다. 원문을 덮어쓰지 않습니다. 원문 백업 후 해당 버전의 앱에서 여세요.",
        CORRUPT_RECORD:
          "로컬 기록의 구조를 확인할 수 없습니다. 원문을 덮어쓰지 않습니다. 원문 구조 백업을 사용하세요.",
        INVALID_BACKUP:
          "지원하지 않는 백업 형식입니다. 정상 형식 2 JSON 백업만 새 사본으로 복원합니다.",
        NOT_FOUND: "저장본을 찾을 수 없습니다.",
      } as const
    )[error.code];
  if (error instanceof RemoteError) {
    if (error.status === 412)
      return "서버 revision이 바뀌었습니다. 현재 입력은 유지됩니다. 서버 내용을 비교한 뒤 fork 또는 명시적 적용을 선택하세요.";
    if (error.status === 401)
      return "서버 세션이 만료되었습니다. 로컬 편집은 계속할 수 있습니다. CMS 로그인 후 계정 확인을 다시 실행하세요.";
    return `서버 요청을 완료하지 못했습니다 (${error.code}). 자동 덮어쓰기나 새 ETag 재시도는 하지 않습니다.`;
  }
  return failureMessage(error);
}

export function Studio() {
  const store = useRef(new DraftStore()).current;
  const [published, setPublished] = useState(false);
  const [rows, setRows] = useState<LocalDraft[]>([]),
    [record, setRecord] = useState<LocalDraft | null>(null),
    recordRef = useRef<LocalDraft | null>(null);
  const [text, setText] = useState(""),
    [savedText, setSavedText] = useState(""),
    savedTextRef = useRef(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false);
  const [saving, setSaving] = useState(false),
    savePromise = useRef<Promise<LocalDraft | null> | null>(null),
    [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<LocalDraft[]>([]),
    [previous, setPrevious] = useState<LocalDraft | null>(null),
    [localOther, setLocalOther] = useState<LocalDraft | null>(null);
  const [shell, setShell] = useState("오프라인 앱 준비를 확인합니다."),
    [waiting, setWaiting] = useState<ServiceWorkerRegistration | null>(null),
    [online, setOnline] = useState(navigator.onLine);
  const [session, setSession] = useState<Session | null>(null),
    [remote, setRemote] = useState<Remote | null>(null),
    [remoteConflict, setRemoteConflict] = useState(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const dirty = record !== null && text !== savedText;
  const candidate = useMemo(() => {
    try {
      if (!record) return null;
      const value = JSON.parse(text);
      return validateDraft({ ...record.draft, candidate: value }).valid
        ? (value as Draft["candidate"])
        : null;
    } catch {
      return null;
    }
  }, [text, record]);
  const sameActor =
    !record?.remote ||
    (record.remote.tenantId === session?.tenantId &&
      record.remote.userId === session?.userId);
  useEffect(() => {
    let live = true;
    void store
      .list()
      .then((value) => {
        if (live) setRows(value);
      })
      .catch((error) => {
        if (live) setNotice(message(error));
      });
    return () => {
      live = false;
      void store.close();
    };
  }, [store]);
  useEffect(() => {
    let cleanup = () => {},
      live = true;
    void prepareStudioShell(
      (value) => {
        if (live) setShell(value);
      },
      (value) => {
        if (live) setWaiting(value);
      },
    )
      .then((value) => {
        if (live) cleanup = value;
        else value();
      })
      .catch(() => {
        if (live)
          setShell(
            "오프라인 앱 준비에 실패했습니다. 연결·저장 공간·HTTPS 또는 loopback 환경을 확인하고 파일 백업을 보관하세요.",
          );
      });
    const network = () => setOnline(navigator.onLine);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      live = false;
      cleanup();
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function refresh() {
    setRows(await store.list());
    if (recordRef.current && recordRef.current.version > 0)
      setHistory(await store.history(recordRef.current.id));
  }
  function select(value: LocalDraft) {
    recordRef.current = value;
    setRecord(value);
    setText(json(value.draft.candidate));
    savedTextRef.current = value.version > 0 ? json(value.draft.candidate) : "";
    setSavedText(savedTextRef.current);
    setPrevious(null);
    setLocalOther(null);
    setRemote(null);
    setRemoteConflict(false);
    setPaused(false);
    attempt.current = null;
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (error) {
      setNotice(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function saveLocal(source = text): Promise<LocalDraft | null> {
    if (savePromise.current) {
      await savePromise.current;
      return saveLocal(source);
    }
    const current = recordRef.current;
    if (!current) return null;
    if (source === savedTextRef.current && current.version > 0) return current;
    const savingTask = Promise.resolve().then(async () => {
      setSaving(true);
      try {
        if (new TextEncoder().encode(source).length > 1000000)
          throw new DraftError("INVALID_DRAFT");
        let document: Draft["candidate"];
        try {
          document = JSON.parse(source);
        } catch {
          throw new DraftError("INVALID_DRAFT");
        }
        const value = await store.save(
          { ...current.draft, candidate: document },
          current.version,
          current.remote,
        );
        if (recordRef.current?.id === current.id) {
          recordRef.current = value;
          setRecord(value);
          savedTextRef.current = source;
          setSavedText(source);
          setPaused(false);
          setLocalOther(null);
          setNotice(`로컬 저장 완료 · version ${value.version}`);
          await refresh();
        }
        return value;
      } catch (error) {
        setPaused(true);
        setNotice(message(error));
        if (error instanceof DraftError && error.code === "LOCAL_CONFLICT") {
          try {
            setLocalOther(await store.get(current.id));
          } catch {
            /* raw rescue remains available */
          }
        }
        return null;
      } finally {
        setSaving(false);
        savePromise.current = null;
      }
    });
    savePromise.current = savingTask;
    return savingTask;
  }
  useEffect(() => {
    if (!dirty || saving || busy || paused) return;
    const timer = setTimeout(() => void saveLocal(text), 700);
    return () => clearTimeout(timer);
  }, [text, record, dirty, saving, busy, paused]);
  async function open(value: LocalDraft) {
    if (dirty && !(await saveLocal())) return;
    const latest = await store.get(value.id);
    if (!latest) throw new DraftError("NOT_FOUND");
    select(latest);
    setHistory(await store.history(latest.id));
    setNotice("완료된 로컬 저장본을 열었습니다.");
  }
  async function create() {
    if (dirty && !(await saveLocal())) return;
    const draft = newDraft();
    const initial: LocalDraft = {
      id: draft.id,
      format: 2,
      version: 0,
      draft,
      updatedAt: draft.updatedAt,
    };
    select(initial);
    const saved = await store.save(draft);
    select(saved);
    await refresh();
    setNotice("계정 없이 로컬 전시 draft를 만들었습니다.");
  }
  async function forkInput() {
    const current = recordRef.current;
    if (!current) return;
    if (current.version === 0) {
      await saveLocal();
      return;
    }
    const input = JSON.parse(text);
    if (!validateDraft({ ...current.draft, candidate: input }).valid)
      throw new DraftError("INVALID_DRAFT");
    const fork = await store.fork({
      ...current,
      draft: { ...current.draft, candidate: input },
    });
    select(fork);
    await refresh();
    setNotice(
      "현재 입력을 새 로컬 사본으로 저장했습니다. 이전 기록과 서버 연결은 유지되며 새 사본은 연결되지 않았습니다.",
    );
  }
  async function backup() {
    const current = recordRef.current;
    if (!current) return;
    if (dirty)
      download(text, `studio-${current.id}-unsaved-input.txt`, "text/plain");
    if (current.version > 0)
      download(
        store.export(current),
        `studio-${current.id}-v${current.version}.json`,
      );
    setNotice(
      "JSON 저장본과 미저장 입력 파일의 다운로드를 요청했습니다. 이 백업은 작품 bytes가 들어 있는 OEX 패키지가 아닙니다.",
    );
  }
  async function importFile(file: File) {
    if (dirty && !(await saveLocal())) return;
    if (file.size > 1200000) throw new DraftError("INVALID_BACKUP");
    const restored = await store.import(await file.text());
    select(restored);
    await refresh();
    setNotice(
      "JSON 백업을 새로운 로컬 사본으로 복원했습니다. 기존 기록은 덮어쓰지 않았습니다.",
    );
  }
  async function remoteRequest(
    method: string,
    current: LocalDraft,
    target?: Remote,
  ): Promise<Remote> {
    if (!session) throw new RemoteError(401, "LOGIN_REQUIRED");
    if (
      current.remote &&
      (current.remote.tenantId !== session.tenantId ||
        current.remote.userId !== session.userId)
    )
      throw new RemoteError(403, "ACCOUNT_BINDING_MISMATCH");
    const path = `/api/v1/tenants/${session.tenantId}/studio/exhibitions${method === "POST" ? "" : `/${current.remote?.id ?? current.draft.exhibitionId}`}`;
    const etag = target?.etag ?? current.remote?.etag;
    const signature = JSON.stringify({
      method,
      path,
      draft: current.draft,
      etag,
    });
    if (
      method !== "GET" &&
      attempt.current &&
      attempt.current.signature !== signature
    )
      throw new RemoteError(409, "PENDING_RECEIPT_REQUIRES_COMPARISON");
    if (method !== "GET" && !attempt.current)
      attempt.current = { signature, id: crypto.randomUUID() };
    const headers: Record<string, string> = {};
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["x-csrf-token"] = session.csrfToken;
      if (method === "PUT") {
        if (!etag) throw new RemoteError(400, "ETAG_REQUIRED");
        headers["if-match"] = etag;
      }
    }
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      signal: AbortSignal.timeout(15000),
      body:
        method === "GET"
          ? undefined
          : JSON.stringify({
              draft: current.draft,
              requestId: attempt.current!.id,
            }),
    });
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ code: "REQUEST_FAILED" }))) as { code?: string };
      if (response.status === 412) {
        attempt.current = null;
        setRemoteConflict(true);
      }
      if (response.status === 400 || response.status === 403)
        attempt.current = null;
      throw new RemoteError(response.status, error.code ?? "REQUEST_FAILED");
    }
    const value = (await response.json()) as Remote;
    if (
      !validateDraft(value.draft).valid ||
      value.etag !== response.headers.get("etag") ||
      !/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(value.etag) ||
      !Number.isSafeInteger(value.revision)
    )
      throw new RemoteError(502, "INVALID_SERVER_RESPONSE");
    return value;
  }
  async function compareRemote() {
    const current = recordRef.current;
    if (!current) return;
    const value = await remoteRequest("GET", current);
    setRemote(value);
    setNotice(
      "서버 내용을 읽었습니다. 비교만 수행했으며 로컬 입력이나 서버 내용을 바꾸지 않았습니다.",
    );
  }
  async function push(target?: Remote) {
    const current = await saveLocal();
    if (!current) return;
    const value = await remoteRequest(
      current.remote || target ? "PUT" : "POST",
      current,
      target,
    );
    setRemote(value);
    const binding: RemoteBinding = {
      tenantId: session!.tenantId,
      userId: session!.userId,
      id: value.draft.exhibitionId,
      etag: value.etag,
      revision: value.revision,
    };
    const bound = await store.save(value.draft, current.version, binding);
    select(bound);
    await refresh();
    attempt.current = null;
    setNotice(
      `서버 revision ${value.revision}을 저장하고 현재 계정 연결을 로컬에 기록했습니다. 자동 publish는 수행하지 않습니다.`,
    );
  }
  async function adoptRemote() {
    if (!remote || !record) return;
    if (dirty) throw new DraftError("LOCAL_CONFLICT");
    const binding: RemoteBinding = {
      tenantId: session!.tenantId,
      userId: session!.userId,
      id: remote.draft.exhibitionId,
      etag: remote.etag,
      revision: remote.revision,
    };
    const value = await store.save(
      { ...remote.draft, id: record.id },
      record.version,
      binding,
    );
    select(value);
    await refresh();
    setNotice(
      "비교한 서버 내용을 명시적으로 로컬에 적용했습니다. 이전 로컬 저장본은 이력에 남습니다.",
    );
  }
  async function applyShell() {
    if (dirty && !(await saveLocal())) return;
    const worker = waiting?.waiting;
    if (!worker) return;
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload, {
      once: true,
    });
    worker.postMessage({ type: "APPLY_STUDIO_SHELL_UPDATE" });
  }
  return (
    <main className="cms-shell studio-shell">
      <header>
        <a className="brand" href="/" aria-label="ExhibitOS 홈">
          ExhibitOS<span>OPEN EXHIBITION</span>
        </a>
        <a href="/cms">Artist CMS</a>
      </header>
      <div className="cms-heading">
        <div>
          <p className="eyebrow">STUDIO · LOCAL DRAFTS</p>
          <h1>
            전시의 초안을
            <br />
            안전하게 이어서.
          </h1>
        </div>
        <span className="phase">
          {online ? "브라우저 연결 상태: 온라인" : "오프라인"}
        </span>
      </div>
      <p className="studio-shell-status" data-testid="shell-status">
        {shell}
      </p>
      {waiting && (
        <button disabled={busy || saving} onClick={() => void run(applyShell)}>
          저장 후 새 앱 버전 적용
        </button>
      )}
      <p role="status" aria-live="polite" className="cms-status">
        {notice || "계정 없이 로컬 draft를 만들고 저장할 수 있습니다."}
      </p>
      <p className="cms-note">
        이 브라우저의 IndexedDB에 저장합니다. 공유 기기의 다른 사용자가 로컬
        draft를 볼 수 있으며 브라우저 데이터 삭제·기기 장애로 사라질 수
        있습니다. 파일 백업을 별도로 보관하세요. 현재 단계는 versioned 문서
        저장, 공간·작품 배치 편집과 검증된 서버 revision의 명시적 공개·철회를 지원합니다. OEX 패키지 생성은
        후속 기능입니다.
      </p>
      <div className="cms-grid">
        <section className="cms-card">
          <div className="cms-actions">
            <h2>로컬 draft</h2>
            <button disabled={busy || saving} onClick={() => void run(create)}>
              새 로컬 전시
            </button>
          </div>
          <ul className="cms-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  data-testid={`draft-${row.id}`}
                  disabled={busy || saving}
                  onClick={() => void run(() => open(row))}
                >
                  {row.draft.candidate.title}
                  <small>
                    version {row.version} ·{" "}
                    {row.remote ? "계정 연결 있음" : "로컬 단독"}
                    <br />
                    {row.updatedAt}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {!rows.length && (
            <p>저장된 draft가 없습니다. 계정 서버 없이 시작할 수 있습니다.</p>
          )}
          <label>
            JSON 백업을 새 사본으로 복원
            <input
              aria-label="JSON 백업을 새 사본으로 복원"
              disabled={busy || saving}
              type="file"
              accept=".json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void run(() => importFile(file));
              }}
            />
          </label>
          <div className="cms-actions">
            <button
              disabled={busy || saving}
              onClick={() =>
                void run(async () => {
                  await refresh();
                  setNotice("로컬 저장소를 다시 읽었습니다.");
                })
              }
            >
              저장소 다시 읽기
            </button>
            <button
              disabled={busy || saving}
              onClick={() =>
                void run(async () => {
                  download(await store.rescue(), "exhibitos-local-rescue.json");
                  setNotice(
                    "기존·손상·미래 형식 기록의 원문 구조 백업을 요청했습니다. 자동 삭제나 복구 덮어쓰기는 수행하지 않습니다.",
                  );
                })
              }
            >
              원문 구조 백업
            </button>
          </div>
          <p className="cms-note">
            형식 1은 지원하는 정상 문서를 형식 2로 이동하고 원문을 보존합니다.
            미래 형식·손상 기록은 덮어쓰지 않고 원문 구조 백업으로 내보냅니다.
          </p>
        </section>
        {record ? (
          <section className="cms-card">
            <div className="cms-actions">
              <h2>전시 draft</h2>
              <span data-testid="local-state">
                {saving
                  ? "저장 중…"
                  : dirty
                    ? "미저장 입력 있음"
                    : `로컬 version ${record.version}`}
              </span>
            </div>
            <p className="cms-note">
              draft ID <code data-testid="draft-id">{record.id}</code>
              <br />
              전시 ID <code>{record.draft.exhibitionId}</code> · OES{" "}
              {record.draft.schemaVersion} · meter / right-handed Y-up
            </p>
            <label>
              전시 제목
              <input
                aria-label="전시 제목"
                disabled={busy || published || !candidate}
                maxLength={512}
                value={candidate?.title ?? ""}
                onChange={(e) => {
                  if (candidate) {
                    setText(json({ ...candidate, title: e.target.value }));
                    setPaused(false);
                  }
                }}
              />
            </label>
            <label>
              전시 문서 JSON
              <textarea
                className="studio-json"
                maxLength={1000000}
                aria-label="전시 문서 JSON"
                disabled={busy || published}
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPaused(false);
                }}
              />
            </label>
            <p className="cms-note">
              rooms·surfaces·openings·placements·transform와 접근성 정보를 OES
              문서로 보존합니다. 스키마·참조 검사를 통과한 내용만 700ms 후 자동
              저장합니다. 유효하지 않은 입력이나 quota 오류는 완료된 저장본을
              덮어쓰지 않습니다.
            </p>
            <div className="cms-actions">
              <button
                disabled={busy || saving || !dirty}
                onClick={() =>
                  void run(async () => {
                    await saveLocal();
                  })
                }
              >
                로컬 저장 다시 시도
              </button>
              <button
                disabled={busy || saving}
                onClick={() => void run(backup)}
              >
                저장본·현재 입력 파일 백업
              </button>
              <button
                disabled={busy || saving || !candidate || record.version === 0}
                onClick={() => void run(forkInput)}
              >
                현재 입력으로 새 로컬 사본
              </button>
            </div>
            {candidate && (
              <section aria-label="문서 구조 요약" className="studio-summary">
                <h3>문서 구조</h3>
                <p>
                  공간 {candidate.rooms.length} · 표면{" "}
                  {candidate.surfaces.length} · 개구부{" "}
                  {candidate.openings.length} · 작품 배치{" "}
                  {candidate.placements.length}
                </p>
                <ul>
                  {candidate.rooms.map((room) => (
                    <li key={room.id}>
                      {room.name} · {room.dimensions.width} ×{" "}
                      {room.dimensions.height} × {room.dimensions.depth} m
                    </li>
                  ))}
                </ul>
                <p>
                  배치 transform과 geometry는 JSON에 유지됩니다. 아래에서
                  방·벽·문·재질을 편집하고 3D 미리보기를 확인할 수 있습니다.
                  작품·조명·camera·동선을 편집할 수 있습니다.
                </p>
              </section>
            )}
            {candidate && (
              <GeometryEditor
                key={record.id}
                candidate={candidate}
                session={session}
                disabled={busy || published}
                onChange={(value) => {
                  setText(json(value));
                  setPaused(false);
                }}
              />
            )}
            {published && (
              <p className="cms-note">
                이 서버 revision에는 공개 이력이 있습니다. 기존 snapshot을
                유지하고 수정하려면 아래에서 새 draft를 만드세요.
              </p>
            )}
            <PublicationPanel
              record={record}
              session={session}
              disabled={busy || saving}
              dirty={dirty}
              onPublished={setPublished}
              onFork={() =>
                void run(async () => {
                  if (dirty && !(await saveLocal())) return;
                  const next = await store.fork(recordRef.current!);
                  select(next);
                  await refresh();
                  setPublished(false);
                  setNotice(
                    "공개 snapshot을 유지하고 새로운 로컬 draft를 만들었습니다. 새 계정 서버 전시로 저장할 수 있습니다.",
                  );
                })
              }
            />
            <fieldset>
              <legend>로컬 이력과 복구</legend>
              <p className="cms-note">
                최근 50개 이력 표시; 이전 이력은 원문 백업에 보존합니다.
              </p>
              <label>
                이전 로컬 저장본
                <select
                  aria-label="이전 로컬 저장본"
                  value={previous?.version ?? ""}
                  onChange={(e) =>
                    setPrevious(
                      history.find(
                        (row) => row.version === Number(e.target.value),
                      ) ?? null,
                    )
                  }
                >
                  <option value="">비교할 version 선택</option>
                  {history.map((row) => (
                    <option key={row.version} value={row.version}>
                      version {row.version} · {row.updatedAt}
                    </option>
                  ))}
                </select>
              </label>
              {previous && (
                <>
                  <div className="cms-comparison">
                    <div>
                      <h3>선택한 저장본</h3>
                      <pre>{json(previous.draft.candidate)}</pre>
                    </div>
                    <div>
                      <h3>현재 입력</h3>
                      <pre>{text}</pre>
                    </div>
                  </div>
                  <div className="cms-actions">
                    <button
                      disabled={busy || saving || dirty}
                      onClick={() =>
                        void run(async () => {
                          const value = await store.recover(
                            record.id,
                            previous.version,
                            record.version,
                          );
                          select(value);
                          await refresh();
                          setNotice(
                            "선택한 이력을 새로운 version으로 복구했습니다. 기존 이력은 유지됩니다.",
                          );
                        })
                      }
                    >
                      선택한 저장본 복구
                    </button>
                    <button
                      disabled={busy || saving}
                      onClick={() =>
                        void run(async () => {
                          if (dirty && !(await saveLocal())) return;
                          const value = await store.fork(previous);
                          select(value);
                          await refresh();
                          setNotice(
                            "선택한 이력을 별도 로컬 사본으로 만들었습니다.",
                          );
                        })
                      }
                    >
                      선택한 이력의 새 사본
                    </button>
                  </div>
                </>
              )}
            </fieldset>
            {localOther && (
              <section className="cms-card">
                <h3>다른 탭과 충돌</h3>
                <div className="cms-comparison">
                  <div>
                    <h4>최신 저장본 · version {localOther.version}</h4>
                    <pre>{json(localOther.draft.candidate)}</pre>
                  </div>
                  <div>
                    <h4>현재 입력 (보존됨)</h4>
                    <pre>{text}</pre>
                  </div>
                </div>
                <p>
                  현재 입력을 새 사본으로 저장하거나 파일로 백업할 수 있습니다.
                  최신 저장본은 자동으로 바꾸지 않습니다.
                </p>
              </section>
            )}
            <fieldset>
              <legend>선택적 서버 저장</legend>
              <p className="cms-note">
                계정 확인과 서버 저장은 명시적으로 실행합니다. 로그인·온라인
                전환·계정 변경만으로 로컬 draft를 서버에 보내지 않습니다.
              </p>
              <div className="cms-actions">
                <a href="/cms">CMS에서 로그인</a>
                <button
                  disabled={busy || !online}
                  onClick={() =>
                    void run(async () => {
                      const value = await request<Session>(
                        "/api/v1/auth/session",
                        null,
                      );
                      if (
                        value.userId !== session?.userId ||
                        value.tenantId !== session?.tenantId
                      ) {
                        setRemote(null);
                        setRemoteConflict(false);
                        attempt.current = null;
                      }
                      setSession(value);
                      setNotice(
                        "현재 서버 계정을 확인했습니다. draft 내용은 보내지 않았습니다.",
                      );
                    })
                  }
                >
                  현재 서버 계정 확인
                </button>
              </div>
              <p>
                {session
                  ? `기관 ${session.tenantId} · 사용자 ${session.userId} · 역할 ${session.role}`
                  : "서버 계정 미확인. 로컬 작업은 계속할 수 있습니다."}
              </p>
              {record.remote && (
                <p className="cms-note">
                  이 draft 연결: 기관 {record.remote.tenantId} · 사용자{" "}
                  {record.remote.userId} · 서버 revision{" "}
                  {record.remote.revision}
                </p>
              )}
              {!sameActor && (
                <p className="cms-status">
                  현재 계정과 이 draft의 서버 연결이 다릅니다. 이전 연결로
                  저장하지 않습니다. 새 로컬 사본을 만들면 현재 계정에 별도
                  전시를 저장할 수 있습니다.
                </p>
              )}
              <div className="cms-actions">
                <button
                  disabled={
                    busy ||
                    saving ||
                    !session ||
                    !online ||
                    !sameActor ||
                    !candidate ||
                    remoteConflict ||
                    published
                  }
                  onClick={() => void run(() => push())}
                >
                  {record.remote
                    ? "기록된 ETag로 서버 저장"
                    : "현재 계정에 새 서버 전시 저장"}
                </button>
                <button
                  disabled={busy || saving || !session || !online || !sameActor}
                  onClick={() => void run(compareRemote)}
                >
                  서버 내용 비교
                </button>
              </div>
              {remote && (
                <>
                  <div className="cms-comparison">
                    <div>
                      <h3>서버 revision {remote.revision}</h3>
                      <pre>{json(remote.draft.candidate)}</pre>
                    </div>
                    <div>
                      <h3>현재 로컬 입력</h3>
                      <pre>{text}</pre>
                    </div>
                  </div>
                  <p className="cms-note">
                    비교한 ETag {remote.etag}. 이후 서버가 바뀌면 다시 412로
                    거부합니다. 적용은 아래 명시적 동작으로만 실행합니다.
                  </p>
                  <div className="cms-actions">
                    <button
                      disabled={busy || saving || dirty || !sameActor}
                      onClick={() => void run(adoptRemote)}
                    >
                      비교한 서버 내용을 로컬에 적용
                    </button>
                    <button
                      disabled={busy || saving || !candidate || !sameActor}
                      onClick={() =>
                        void run(async () => {
                          attempt.current = null;
                          await push(remote);
                        })
                      }
                    >
                      현재 로컬 입력을 비교한 서버에 적용
                    </button>
                    <button
                      disabled={busy || saving || !candidate}
                      onClick={() => void run(forkInput)}
                    >
                      충돌 입력의 새 로컬 사본
                    </button>
                  </div>
                </>
              )}
            </fieldset>
          </section>
        ) : (
          <section className="cms-card">
            <h2>로컬 전시를 시작하세요</h2>
            <p>
              계정과 서버 없이 새 draft를 만들거나 JSON 백업을 새 사본으로
              복원합니다. 처음 한 번 앱 코드의 오프라인 준비가 완료되어야 연결을
              끊고 다시 열 수 있습니다.
            </p>
          </section>
        )}
      </div>
      <footer>
        IndexedDB 형식 2 · JSON 문서와 서버 revision 연결만 저장합니다.
        자격정보와 작품 bytes를 백업에 넣지 않습니다. JSON 파일 백업은 전체 OEX
        패키지가 아닙니다. <a href="/THIRD_PARTY_NOTICES.txt">제3자 고지</a>
      </footer>
    </main>
  );
}
