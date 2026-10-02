import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArtworkPreview } from "./ArtworkPreview";
import {
  emptyMetadata,
  failureMessage,
  request,
  RequestError,
} from "./cms-client";
import type {
  Artist,
  Artwork,
  ArtworkSummary,
  Job,
  Metadata,
  Page,
  Revision,
  Rights,
  Session,
} from "./cms-client";

function RightsFields({
  value,
  onChange,
}: {
  value: Rights;
  onChange: (rights: Rights) => void;
}) {
  const change = (key: keyof Rights, text: string) => {
    const next = { ...value };
    if (text) Object.assign(next, { [key]: text });
    else delete next[key];
    onChange(next);
  };
  return (
    <fieldset>
      <legend>작품 권리와 원본 정책</legend>
      <p className="cms-note">
        코드의 AGPL 라이선스는 작품에 적용되지 않습니다. 권리자와 허용 범위를
        직접 검토하세요.
      </p>
      <label>
        권리자
        <input
          aria-label="권리자"
          required
          maxLength={512}
          value={value.holder}
          onChange={(e) => onChange({ ...value, holder: e.target.value })}
        />
      </label>
      <label>
        권리 근거
        <select
          aria-label="권리 근거"
          value={value.ownership}
          onChange={(e) =>
            onChange({
              ...value,
              ownership: e.target.value as Rights["ownership"],
            })
          }
        >
          <option value="owner">소유자</option>
          <option value="authorized-licensee">허가받은 이용자</option>
        </select>
      </label>
      <label>
        라이선스 ID
        <input
          aria-label="라이선스 ID"
          maxLength={128}
          value={value.licenseId ?? ""}
          onChange={(e) => change("licenseId", e.target.value)}
        />
      </label>
      <label>
        라이선스 전문
        <textarea
          aria-label="라이선스 전문"
          maxLength={16384}
          value={value.licenseText ?? ""}
          onChange={(e) => change("licenseText", e.target.value)}
        />
      </label>
      <p className="cms-note">라이선스 ID 또는 전문 중 하나는 필요합니다.</p>
      <div className="cms-checks">
        {(
          [
            ["display", "전시 허용"],
            ["download", "원본 다운로드 허용"],
            ["export", "내보내기 허용"],
            ["commercial", "상업 이용 허용"],
          ] as const
        ).map(([key, title]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value.permissions[key]}
              onChange={(e) =>
                onChange({
                  ...value,
                  permissions: {
                    ...value.permissions,
                    [key]: e.target.checked,
                  },
                })
              }
            />
            {title}
          </label>
        ))}
      </div>
      <label>
        권리·크레딧 고지
        <input
          aria-label="권리·크레딧 고지"
          maxLength={2048}
          value={value.creditLine}
          onChange={(e) => onChange({ ...value, creditLine: e.target.value })}
        />
      </label>
      <label>
        효력 시작 (UTC)
        <input
          aria-label="효력 시작 (UTC)"
          placeholder="2026-10-01T00:00:00Z"
          value={value.validFrom ?? ""}
          onChange={(e) => change("validFrom", e.target.value)}
        />
      </label>
      <label>
        효력 종료 (UTC)
        <input
          aria-label="효력 종료 (UTC)"
          placeholder="2027-10-01T00:00:00Z"
          value={value.expiresAt ?? ""}
          onChange={(e) => change("expiresAt", e.target.value)}
        />
      </label>
    </fieldset>
  );
}

export function Cms() {
  const [session, setSession] = useState<Session | null>(null),
    [sessionReady, setSessionReady] = useState(false);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<"artworks" | "artists">("artworks");
  const [artists, setArtists] = useState<Artist[]>([]),
    [artistCursor, setArtistCursor] = useState<string | null>(null);
  const [artworks, setArtworks] = useState<ArtworkSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [filter, setFilter] = useState(""),
    [archived, setArchived] = useState(false);
  const [artistRevisions, setArtistRevisions] = useState<Revision[]>([]),
    [artistCompare, setArtistCompare] = useState<Revision | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null),
    [artistName, setArtistName] = useState(""),
    [artistBio, setArtistBio] = useState(""),
    [artistUser, setArtistUser] = useState("");
  const [artwork, setArtwork] = useState<Artwork | null>(null),
    [editing, setEditing] = useState(false),
    [artistId, setArtistId] = useState(""),
    [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [revisions, setRevisions] = useState<Revision[]>([]),
    [compare, setCompare] = useState<Revision | null>(null);
  const [job, setJob] = useState<Job | null>(null),
    [file, setFile] = useState<File | null>(null),
    [fileInputVersion, setFileInputVersion] = useState(0),
    [scale, setScale] = useState("1"),
    [assetId, setAssetId] = useState(""),
    [preview, setPreview] = useState(false);
  const prefix = session ? `/api/v1/tenants/${session.tenantId}/cms` : "";
  const uploadIntent = useRef<{
    signature: string;
    key: string;
    jobId: string | null;
  } | null>(null);
  const canEdit = session?.role === "admin" || session?.role === "artist";
  function clearFile() {
    setFile(null);
    setFileInputVersion(previous => previous + 1);
  }
  function clearWorkspace() {
    setTab("artworks");
    setArtists([]);
    setArtistCursor(null);
    setArtworks([]);
    setCursor(null);
    setFilter("");
    setArchived(false);
    setArtist(null);
    setArtistName("");
    setArtistBio("");
    setArtistUser("");
    setArtistRevisions([]);
    setArtistCompare(null);
    setArtwork(null);
    setEditing(false);
    setArtistId("");
    setMetadata(emptyMetadata());
    setRevisions([]);
    setCompare(null);
    setJob(null);
    clearFile();
    setScale("1");
    setAssetId("");
    setPreview(false);
    uploadIntent.current = null;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (error) {
      setNotice(failureMessage(error));
      if (error instanceof RequestError && error.status === 401)
        setExpired(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void request<Session>("/api/v1/auth/session", null)
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function loadArtists(more = false) {
    if (!session) return;
    const page = await request<Page<Artist>>(
      `${prefix}/artists?limit=50&archived=${archived}${more && artistCursor ? `&cursor=${encodeURIComponent(artistCursor)}` : ""}`,
      session,
    );
    setArtists((previous) =>
      more ? [...previous, ...page.items] : page.items,
    );
    setArtistCursor(page.nextCursor);
  }
  async function loadArtworks(more = false) {
    if (!session) return;
    const page = await request<Page<ArtworkSummary>>(
      `${prefix}/artworks?limit=20&archived=${archived}&q=${encodeURIComponent(filter)}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      session,
    );
    setArtworks((previous) =>
      more ? [...previous, ...page.items] : page.items,
    );
    setCursor(page.nextCursor);
  }
  useEffect(() => {
    if (!session) return;
    let active = true;
    const current = `/api/v1/tenants/${session.tenantId}/cms`;
    void Promise.all([
      request<Page<Artist>>(
        `${current}/artists?limit=50&archived=${archived}`,
        session,
      ),
      request<Page<ArtworkSummary>>(
        `${current}/artworks?limit=20&archived=${archived}`,
        session,
      ),
    ])
      .then(([a, b]) => {
        if (active) {
          setArtists(a.items);
          setArtistCursor(a.nextCursor);
          setArtworks(b.items);
          setCursor(b.nextCursor);
        }
      })
      .catch((error) => {
        if (active) setNotice(failureMessage(error));
      });
    return () => {
      active = false;
    };
  }, [session, archived]);
  useEffect(() => {
    if (
      !session ||
      !job ||
      !["uploading", "queued", "processing"].includes(job.state)
    )
      return;
    let active = true;
    const timer = setTimeout(() => {
      void request<Job>(
        `/api/v1/tenants/${session.tenantId}/imports/${job.id}`,
        session,
      )
        .then((value) => {
          if (active) {
            setJob(value);
            if (value.assetId) setAssetId(value.assetId);
          }
        })
        .catch((error) => {
          if (active) setNotice(failureMessage(error));
        });
    }, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, job]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    await action(async () => {
      await request("/api/v1/auth/login", null, "POST", {
        subject: data.get("subject"),
        password: data.get("password"),
        tenantId: data.get("tenantId"),
      });
      form.reset();
      setSession(await request<Session>("/api/v1/auth/session", null));
      setExpired(false);
      clearWorkspace();
      setNotice("로그인되었습니다. 로그인 계정과 작가 identity는 별개입니다.");
    });
  }
  async function openArtwork(id: string) {
    const value = await request<Artwork>(`${prefix}/artworks/${id}`, session);
    setArtwork(value);
    setMetadata(
      value.metadata ? structuredClone(value.metadata) : emptyMetadata(),
    );
    setArtistId(value.artistId);
    setAssetId(
      value.approvedAssetId ??
        value.assets.find((a) => a.state === "approved")?.id ??
        "",
    );
    setEditing(true);
    setJob(null);
    clearFile();
    setPreview(false);
    setCompare(null);
    uploadIntent.current = null;
    if (!value.metadata)
      setNotice(
        "이 작품에는 이전 형식의 메타데이터가 있습니다. 치수·권리·출처를 입력하고 새 revision으로 저장하세요.",
      );
    setRevisions(
      (
        await request<Page<Revision>>(
          `${prefix}/artworks/${id}/revisions`,
          session,
        )
      ).items,
    );
  }
  function newArtwork() {
    setArtwork(null);
    setMetadata(emptyMetadata());
    setArtistId(artists.find((a) => !a.archived)?.id ?? "");
    setEditing(true);
    setJob(null);
    clearFile();
    setAssetId("");
    setPreview(false);
    setRevisions([]);
    setCompare(null);
    uploadIntent.current = null;
  }
  async function saveArtwork(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      if (!metadata.rights.licenseId && !metadata.rights.licenseText)
        throw new RequestError(400, "LICENSE_REQUIRED");
      const value = await request<Artwork>(
        artwork ? `${prefix}/artworks/${artwork.id}` : `${prefix}/artworks`,
        session,
        artwork ? "PATCH" : "POST",
        artwork
          ? { revision: artwork.revision, ...metadata }
          : { artistId, ...metadata },
      );
      await loadArtworks();
      await openArtwork(value.id);
      setNotice(
        "작품 메타데이터를 저장했습니다. 변경한 revision은 다시 검토·승인하세요.",
      );
    });
  }
  async function openArtist(id: string) {
    const value = await request<Artist>(`${prefix}/artists/${id}`, session);
    setArtist(value);
    setArtistName(value.name);
    setArtistBio(value.bio);
    setArtistUser(value.userId ?? "");
    setArtistCompare(null);
    setArtistRevisions(
      (
        await request<Page<Revision>>(
          `${prefix}/artists/${id}/revisions`,
          session,
        )
      ).items,
    );
  }
  async function saveArtist(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      const value = await request<Artist>(
        artist ? `${prefix}/artists/${artist.id}` : `${prefix}/artists`,
        session,
        artist ? "PATCH" : "POST",
        artist
          ? { revision: artist.revision, name: artistName, bio: artistBio }
          : {
              name: artistName,
              bio: artistBio,
              ...(artistUser ? { userId: artistUser } : {}),
            },
      );
      await openArtist(value.id);
      await loadArtists();
      setNotice(
        "작가 identity를 저장했습니다. 로그인 계정의 자격정보는 변경하지 않았습니다.",
      );
    });
  }
  async function upload() {
    if (!artwork || !file || !session) return;
    await action(async () => {
      if (file.size < 1 || file.size > 32 * 1024 * 1024)
        throw Error("파일은 1바이트에서 32 MiB까지 지원합니다.");
      const mime = file.name.toLowerCase().endsWith(".glb")
        ? "model/gltf-binary"
        : file.name.toLowerCase().endsWith(".png")
          ? "image/png"
          : null;
      if (!mime) throw Error("파일은 GLB 또는 PNG만 지원합니다.");
      if (!Number.isFinite(Number(scale)) || Number(scale) <= 0 || Number(scale) > 1000000)
        throw Error("파일의 미터 scale은 0보다 크고 1,000,000 이하여야 합니다.");
      const bytes = await file.arrayBuffer(),
        hash = await crypto.subtle.digest("SHA-256", bytes),
        sha256 = Array.from(new Uint8Array(hash), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
      const payload = {
        artworkId: artwork.id,
        mime,
        bytes: bytes.byteLength,
        sha256,
        scaleMeters: Number(scale),
        rights: metadata.rights,
      };
      const signature = JSON.stringify(payload);
      if (uploadIntent.current && uploadIntent.current.signature !== signature)
        throw Error(
          "파일 또는 권리 입력이 바뀌었습니다. 기존 검사를 취소하거나 완료한 뒤 “다른 파일 검사 시작”을 선택하세요.",
        );
      if (!uploadIntent.current)
        uploadIntent.current = {
          signature,
          key: crypto.randomUUID(),
          jobId: null,
        };
      let value: Job;
      try {
        value = await request<Job>(
          `/api/v1/tenants/${session.tenantId}/imports`,
          session,
          "POST",
          { ...payload, idempotencyKey: uploadIntent.current.key },
        );
      } catch (error) {
        // Definitive invalid input cannot have created a job in the transaction.
        // A lost response can: retain its key for exact replay and recovery.
        if (error instanceof RequestError && error.status === 400)
          uploadIntent.current = null;
        throw error;
      }
      uploadIntent.current.jobId = value.id;
      setJob(value);
      if (value.state !== "uploading") {
        setNotice(
          "기존 검사 요청을 다시 찾았습니다. 현재 상태에 맞게 검사 재시도 또는 파일 목록 읽기를 선택하세요.",
        );
        return;
      }
      await request<{ received: number }>(
        `/api/v1/tenants/${session.tenantId}/imports/${value.id}/bytes`,
        session,
        "PUT",
        bytes,
      );
      value = await request<Job>(
        `/api/v1/tenants/${session.tenantId}/imports/${value.id}/complete`,
        session,
        "POST",
      );
      setJob(value);
      setNotice(
        "비공개 검사 대기 중입니다. 운영자가 import worker를 실행해야 합니다. 파일 검사 승인 후 작품 revision을 별도로 승인하세요.",
      );
    });
  }
  async function jobAction(kind: "retry" | "cancel" | "complete") {
    if (job && session)
      await action(async () =>
        setJob(
          await request<Job>(
            `/api/v1/tenants/${session.tenantId}/imports/${job.id}/${kind}`,
            session,
            "POST",
          ),
        ),
      );
  }
  async function recoverUpload() {
    const intent = uploadIntent.current;
    if (!intent || !session) return;
    await action(async () => {
      const value = await request<Job>(
        `/api/v1/tenants/${session.tenantId}/imports`, session, "POST",
        { ...JSON.parse(intent.signature), idempotencyKey: intent.key },
      );
      intent.jobId = value.id;
      setJob(value);
      setNotice("이전 요청의 파일·권리·scale과 동일한 검사 요청을 찾았습니다. 현재 입력을 자동으로 바꾸지 않습니다. 같은 입력으로 재시도하거나 검사를 취소하세요.");
    });
  }
  async function downloadOriginal() {
    if (!assetId || !session) return;
    await action(async () => {
      const response = await fetch(
        `/api/v1/tenants/${session.tenantId}/assets/${assetId}/bytes`,
        { credentials: "same-origin", signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) {
        const body = (await response.json()) as { code?: string };
        throw new RequestError(response.status, body.code ?? "ORIGINAL_DENIED");
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `artwork-${artwork?.id ?? "asset"}.${artwork?.assets.find((a) => a.id === assetId)?.mime === "image/png" ? "png" : "glb"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("서버가 원본 다운로드 권한을 확인했습니다.");
    });
  }
  return (
    <main className="cms-shell">
      <header>
        <a className="brand" href="/" aria-label="ExhibitOS 홈">
          ExhibitOS<span>OPEN EXHIBITION</span>
        </a>
        <span className="phase">Artist CMS · 비공개 개발</span>
      </header>
      <div className="cms-heading">
        <div>
          <p className="eyebrow">ARTIST WORKSPACE</p>
          <h1>작품의 기록과 권리.</h1>
        </div>
        {session && (
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request("/api/v1/auth/logout", session, "POST");
                setSession(null);
                setExpired(false);
                clearWorkspace();
                setNotice("로그아웃되었습니다.");
              })
            }
          >
            로그아웃
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="cms-status">
        {notice ||
          (!sessionReady
            ? "세션 확인 중…"
            : session
              ? "비공개 작업 공간입니다. 서버가 모든 접근 권한을 검사합니다."
              : "기관과 계정을 지정해 로그인하세요.")}
      </p>
      {session && expired && (
        <div className="cms-card">
          <p>
            세션이 만료되었습니다. 현재 입력을 복사해 보관한 뒤 다시
            로그인하세요. 재로그인하면 이전 작업 화면이 닫힙니다.
          </p>
          <button
            onClick={() => {
              setSession(null);
              setExpired(false);
            }}
          >
            다시 로그인
          </button>
        </div>
      )}
      {!session ? (
        <form
          className="cms-card cms-login"
          onSubmit={(event) => void login(event)}
        >
          <h2>CMS 로그인</h2>
          <label>
            기관 ID
            <input
              aria-label="기관 ID"
              name="tenantId"
              required
              autoComplete="organization"
              placeholder="기관 UUID"
            />
          </label>
          <label>
            계정
            <input
              aria-label="계정"
              name="subject"
              required
              minLength={3}
              maxLength={128}
              autoComplete="username"
            />
          </label>
          <label>
            비밀번호
            <input
              aria-label="비밀번호"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={1024}
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy || !sessionReady}>로그인</button>
          <p className="cms-note">
            가입·계정 발급은 관리자가 수행합니다. 로그인 비밀번호는 브라우저
            저장소에 저장하지 않습니다.
          </p>
        </form>
      ) : (
        <>
          <p className="cms-note">
            로그인 사용자: <code>{session.userId}</code> · 역할 {session.role} ·
            기관 <code>{session.tenantId}</code>
            <br />
            작가 identity에는 별도의 이름·소개·ID가 있습니다.
          </p>
          <nav className="cms-tabs" aria-label="CMS 메뉴">
            <button
              aria-pressed={tab === "artworks"}
              disabled={busy}
              onClick={() => setTab("artworks")}
            >
              작품
            </button>
            <button
              aria-pressed={tab === "artists"}
              disabled={busy}
              onClick={() => setTab("artists")}
            >
              작가
            </button>
            <label className="cms-inline">
              <input
                type="checkbox"
                disabled={busy}
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setFilter("");
                }}
              />
              보관된 항목
            </label>
          </nav>
          {tab === "artists" ? (
            <div className="cms-grid">
              <section className="cms-card">
                <div className="cms-actions">
                  <h2>작가 목록</h2>
                  {canEdit && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setArtist(null);
                        setArtistName("");
                        setArtistBio("");
                        setArtistUser("");
                        setArtistRevisions([]);
                        setArtistCompare(null);
                      }}
                    >
                      새 작가
                    </button>
                  )}
                </div>
                <ul className="cms-list">
                  {artists.map((item) => (
                    <li key={item.id}>
                      <button
                        disabled={busy}
                        onClick={() => void action(() => openArtist(item.id))}
                      >
                        {item.name}{" "}
                        <small>
                          revision {item.revision}
                          {item.archived ? " · 보관됨" : ""}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                {artists.length === 0 && <p>등록된 작가가 없습니다.</p>}
                {artistCursor && (
                  <button
                    disabled={busy}
                    onClick={() => void action(() => loadArtists(true))}
                  >
                    작가 더 보기
                  </button>
                )}
              </section>
              <form
                className="cms-card"
                onSubmit={(event) => void saveArtist(event)}
              >
                <h2>{artist ? "작가 수정" : "작가 등록"}</h2>
                <label>
                  작가 이름
                  <input
                    aria-label="작가 이름"
                    required
                    maxLength={512}
                    value={artistName}
                    onChange={(e) => setArtistName(e.target.value)}
                    disabled={!canEdit || busy}
                  />
                </label>
                <label>
                  작가 소개
                  <textarea
                    aria-label="작가 소개"
                    maxLength={4096}
                    value={artistBio}
                    onChange={(e) => setArtistBio(e.target.value)}
                    disabled={!canEdit || busy}
                  />
                </label>
                {session.role === "admin" && !artist && (
                  <label>
                    연결할 로그인 사용자 ID (선택)
                    <input
                      aria-label="연결할 로그인 사용자 ID (선택)"
                      value={artistUser}
                      onChange={(e) => setArtistUser(e.target.value)}
                      placeholder="비우면 현재 사용자"
                    />
                  </label>
                )}
                <p className="cms-note">
                  작가 ID: {artist?.id ?? "저장 후 생성"}
                  <br />
                  연결된 로그인 ID:{" "}
                  {artist
                    ? (artist.userId ?? "연결되지 않음")
                    : artistUser || session.userId}
                </p>
                {canEdit && (
                  <div className="cms-actions">
                    <button disabled={busy || !!artist?.archived}>
                      작가 저장
                    </button>
                    {artist && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            setArtist(
                              await request<Artist>(
                                `${prefix}/artists/${artist.id}/${artist.archived ? "restore" : "archive"}`,
                                session,
                                "POST",
                                { revision: artist.revision },
                              ),
                            );
                            await loadArtists();
                            setNotice(
                              "작가 보관 상태를 변경했습니다. 실제 데이터는 삭제하지 않았습니다.",
                            );
                          })
                        }
                      >
                        {artist.archived ? "작가 복원" : "작가 보관"}
                      </button>
                    )}
                  </div>
                )}
                {artist && (
                  <fieldset>
                    <legend>작가 변경 이력</legend>
                    <label>
                      이전 작가 revision
                      <select
                        aria-label="이전 작가 revision"
                        value={artistCompare?.revision ?? ""}
                        onChange={(e) =>
                          setArtistCompare(
                            artistRevisions.find(
                              (r) => r.revision === Number(e.target.value),
                            ) ?? null,
                          )
                        }
                      >
                        <option value="">비교할 revision 선택</option>
                        {artistRevisions.map((r) => (
                          <option key={r.revision} value={r.revision}>
                            revision {r.revision} · {r.createdAt}
                          </option>
                        ))}
                      </select>
                    </label>
                    {artistCompare && (
                      <div className="cms-comparison">
                        <pre>
                          {JSON.stringify(artistCompare.snapshot, null, 2)}
                        </pre>
                        <pre>
                          {JSON.stringify(
                            { name: artistName, bio: artistBio },
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void action(() => openArtist(artist.id))}
                    >
                      작가 서버 내용 새로 읽기
                    </button>
                  </fieldset>
                )}
              </form>
            </div>
          ) : (
            <div className="cms-grid">
              <section className="cms-card">
                <div className="cms-actions">
                  <h2>작품 목록</h2>
                  {canEdit && (
                    <button disabled={busy} onClick={newArtwork}>
                      새 작품
                    </button>
                  )}
                </div>
                <form
                  className="cms-filter"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(() => loadArtworks());
                  }}
                >
                  <label>
                    작품 제목 검색
                    <input
                      aria-label="작품 제목 검색"
                      disabled={busy}
                      maxLength={100}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </label>
                  <button disabled={busy}>검색</button>
                </form>
                <ul className="cms-list">
                  {artworks.map((item) => (
                    <li key={item.id}>
                      <button
                        disabled={busy}
                        onClick={() => void action(() => openArtwork(item.id))}
                      >
                        {item.title}
                        <small>
                          revision {item.revision} ·{" "}
                          {item.approvedRevision === item.revision
                            ? "검토 승인"
                            : "검토 필요"}
                          {item.archived ? " · 보관됨" : ""}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                {artworks.length === 0 && (
                  <p>
                    표시할 작품이 없습니다. 작가를 등록한 다음 작품을 만드세요.
                  </p>
                )}
                {cursor && (
                  <button
                    disabled={busy}
                    onClick={() => void action(() => loadArtworks(true))}
                  >
                    작품 더 보기
                  </button>
                )}
              </section>
              {editing ? (
                <section className="cms-card">
                  <form onSubmit={(e) => void saveArtwork(e)}>
                    <h2>{artwork ? "작품 상세" : "작품 등록"}</h2>
                    <fieldset
                      disabled={!canEdit || !!artwork?.archived || busy}
                    >
                      <label>
                        작가 identity
                        <select
                          aria-label="작가 identity"
                          required
                          value={artistId}
                          disabled={!!artwork}
                          onChange={(e) => setArtistId(e.target.value)}
                        >
                          <option value="">작가 선택</option>
                          {artists.map((a) => (
                            <option value={a.id} key={a.id}>
                              {a.name}
                              {a.archived ? " (보관됨)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {artistCursor && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void action(() => loadArtists(true))}
                        >
                          작가 선택 목록 더 읽기
                        </button>
                      )}
                      <label>
                        작품 제목
                        <input
                          aria-label="작품 제목"
                          required
                          maxLength={512}
                          value={metadata.title}
                          onChange={(e) =>
                            setMetadata({ ...metadata, title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        작품 설명
                        <textarea
                          aria-label="작품 설명"
                          maxLength={8192}
                          value={metadata.description}
                          onChange={(e) =>
                            setMetadata({
                              ...metadata,
                              description: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        재료·기법 (공개, 선택)
                        <input
                          aria-label="재료·기법"
                          maxLength={512}
                          value={metadata.medium ?? ""}
                          onChange={(e) => {
                            const next = { ...metadata };
                            if (e.target.value.trim()) next.medium = e.target.value;
                            else delete next.medium;
                            setMetadata(next);
                          }}
                        />
                      </label>
                      <label>
                        제작 연도 (공개, 선택)
                        <input
                          aria-label="제작 연도"
                          type="number"
                          min={1}
                          max={9999}
                          step={1}
                          value={metadata.creationYear ?? ""}
                          onChange={(e) => {
                            const next = { ...metadata };
                            if (e.target.value === "") delete next.creationYear;
                            else next.creationYear = e.target.valueAsNumber;
                            setMetadata(next);
                          }}
                        />
                      </label>
                      <p className="cms-note">
                        재료와 제작 연도는 검토·승인한 작품의 공개 상세 보기에
                        표시됩니다. 모르는 값은 비워 두세요. 기록 저장일을 제작
                        연도로 추정하지 않습니다.
                      </p>
                      <fieldset>
                        <legend>실제 치수 (미터)</legend>
                        <p className="cms-note">이미지의 깊이를 기록하지 않았다면 비워 두세요. 3D 모델 승인에는 깊이가 필요합니다.</p>
                        <div className="cms-dimensions">
                          {(
                            [
                              ["width", "너비"],
                              ["height", "높이"],
                              ["depth", "깊이"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <input
                                aria-label={label}
                                type="number"
                                required={key !== "depth"}
                                min="0.000001"
                                max="1000000"
                                step="any"
                                value={metadata.dimensions[key] ?? ""}
                                onChange={(e) =>
                                  setMetadata({
                                    ...metadata,
                                    dimensions: {
                                      ...metadata.dimensions,
                                      [key]: key === "depth" && e.target.value === "" ? undefined : Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <RightsFields
                        value={metadata.rights}
                        onChange={(rights) =>
                          setMetadata({ ...metadata, rights })
                        }
                      />
                      <fieldset>
                        <legend>출처와 변환 기록</legend>
                        <label>
                          제작 방식
                          <select
                            aria-label="제작 방식"
                            value={metadata.provenance.source}
                            onChange={(e) =>
                              setMetadata({
                                ...metadata,
                                provenance: {
                                  ...metadata.provenance,
                                  source: e.target
                                    .value as Metadata["provenance"]["source"],
                                },
                              })
                            }
                          >
                            <option value="human-authored">사람이 제작</option>
                            <option value="ai-assisted">AI 보조</option>
                            <option value="ai-generated">AI 생성</option>
                            <option value="synthetic">합성 예제</option>
                          </select>
                        </label>
                        <label>
                          원본 단위
                          <select
                            aria-label="원본 단위"
                            value={metadata.provenance.sourceUnits}
                            onChange={(e) =>
                              setMetadata({
                                ...metadata,
                                provenance: {
                                  ...metadata.provenance,
                                  sourceUnits: e.target
                                    .value as Metadata["provenance"]["sourceUnits"],
                                },
                              })
                            }
                          >
                            <option value="m">미터</option>
                            <option value="cm">센티미터</option>
                            <option value="mm">밀리미터</option>
                          </select>
                        </label>
                        <label className="cms-inline">
                          <input
                            type="checkbox"
                            checked={metadata.provenance.scaleApplied}
                            onChange={(e) =>
                              setMetadata({
                                ...metadata,
                                provenance: {
                                  ...metadata.provenance,
                                  scaleApplied: e.target.checked,
                                },
                              })
                            }
                          />
                          미터 변환을 파일에 이미 적용함
                        </label>
                        <label>
                          출처·단위 변환 메모
                          <textarea
                            aria-label="출처·단위 변환 메모"
                            maxLength={4096}
                            value={metadata.provenance.notes}
                            onChange={(e) =>
                              setMetadata({
                                ...metadata,
                                provenance: {
                                  ...metadata.provenance,
                                  notes: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      </fieldset>
                      {canEdit && (
                        <button disabled={busy}>작품 메타데이터 저장</button>
                      )}
                    </fieldset>
                  </form>
                  {artwork && (
                    <>
                      <div className="cms-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await openArtwork(artwork.id);
                              setNotice(
                                "서버 revision을 읽었습니다. 이전의 미저장 입력은 새로 읽은 내용으로 대체되었습니다.",
                              );
                            })
                          }
                        >
                          서버 내용 새로 읽기
                        </button>
                        {canEdit && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await request(
                                  `${prefix}/artworks/${artwork.id}/${artwork.archived ? "restore" : "archive"}`,
                                  session,
                                  "POST",
                                  { revision: artwork.revision },
                                );
                                await loadArtworks();
                                await openArtwork(artwork.id);
                                setNotice(
                                  "작품 보관 상태를 변경했습니다. 파일과 revision은 유지됩니다.",
                                );
                              })
                            }
                          >
                            {artwork.archived ? "작품 복원" : "작품 보관"}
                          </button>
                        )}
                      </div>
                      <p>
                        현재 revision {artwork.revision} · 승인된 revision{" "}
                        {artwork.approvedRevision ?? "없음"}
                      </p>
                      {canEdit && !artwork.archived && (
                        <fieldset>
                          <legend>GLB / PNG 등록과 파일 검사</legend>
                          <p className="cms-note">
                            자기 포함 GLB 또는 8-bit RGB/RGBA PNG, 최대 32 MiB.
                            외부 참조·텍스처 GLB 및 PNG 메타데이터는 현재
                            지원하지 않습니다. 서버 worker 검사를 거쳐야 합니다.
                            전시용 GLB 워터마크는 애니메이션·스킨·모프·비항등
                            노드 변환 없이 단일 scene으로 구성된 모델만
                            지원합니다.
                          </p>
                          <label>
                            작품 파일
                            <input
                              aria-label="작품 파일"
                              disabled={busy}
                              key={fileInputVersion}
                              type="file"
                              accept=".glb,.png"
                              onChange={(e) =>
                                setFile(e.target.files?.[0] ?? null)
                              }
                            />
                          </label>
                          <label>
                            파일의 미터 scale
                            <input
                              aria-label="파일의 미터 scale"
                              type="number"
                              min="0.000001"
                              max="1000000"
                              step="any"
                              value={scale}
                              onChange={(e) => setScale(e.target.value)}
                            />
                          </label>
                          <p className="cms-note">
                            실제 치수와 별도 기록입니다. 파일 변환을 중복
                            적용하지 마세요.
                          </p>
                          <button
                            disabled={
                              busy ||
                              !file ||
                              !Number.isFinite(Number(scale)) ||
                              Number(scale) <= 0 || Number(scale) > 1000000
                            }
                            onClick={() => void upload()}
                          >
                            {job?.state === "uploading"
                              ? "파일 업로드 재시도"
                              : "파일 업로드·검사 요청"}
                          </button>
                          {!job && uploadIntent.current && <button disabled={busy} onClick={() => void recoverUpload()}>이전 업로드 요청 찾기</button>}
                          {job && (
                            <div>
                              <p data-testid="import-state">
                                파일 검사: {job.state} · 진행 {job.progress}% ·
                                시도 {job.attempts}
                              </p>
                              {job.errorCode && (
                                <p>검사 오류: {job.errorCode}</p>
                              )}
                              {job.retryAt && (
                                <p>재시도 가능 시각: {job.retryAt}</p>
                              )}
                              <div className="cms-actions">
                                {["uploading", "queued", "processing"].includes(
                                  job.state,
                                ) && (
                                  <button
                                    disabled={busy}
                                    onClick={() => void jobAction("cancel")}
                                  >
                                    검사 취소
                                  </button>
                                )}
                                {job.state === "uploading" && (
                                  <button
                                    disabled={busy}
                                    onClick={() => void jobAction("complete")}
                                  >
                                    업로드 완료 재시도
                                  </button>
                                )}
                                {["failed", "cancelled"].includes(
                                  job.state,
                                ) && (
                                  <button
                                    disabled={busy}
                                    onClick={() => void jobAction("retry")}
                                  >
                                    검사 재시도
                                  </button>
                                )}
                                {["approved", "failed", "cancelled"].includes(
                                  job.state,
                                ) && (
                                  <button
                                    disabled={busy}
                                    onClick={() => {
                                      uploadIntent.current = null;
                                      setJob(null);
                                      clearFile();
                                      setNotice(
                                        "새 검사 요청을 시작합니다. 기존 파일과 검사 기록은 유지됩니다.",
                                      );
                                    }}
                                  >
                                    다른 파일 검사 시작
                                  </button>
                                )}
                                {job.state === "approved" && (
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void action(() => openArtwork(artwork.id))
                                    }
                                  >
                                    검사된 파일 목록 읽기
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </fieldset>
                      )}
                      <fieldset>
                        <legend>전시 승인과 미리보기</legend>
                        <label>
                          검사 승인된 파일
                          <select
                            disabled={busy}
                            aria-label="검사 승인된 파일"
                            value={assetId}
                            onChange={(e) => {
                              setAssetId(e.target.value);
                              setPreview(false);
                            }}
                          >
                            <option value="">파일 선택</option>
                            {artwork.assets
                              .filter((a) => a.state === "approved")
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.mime} · {a.bytes} bytes · {a.id}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="cms-actions">
                          {canEdit && (
                            <button
                              disabled={busy || !assetId || artwork.archived}
                              onClick={() =>
                                void action(async () => {
                                  await request(
                                    `${prefix}/artworks/${artwork.id}/approve`,
                                    session,
                                    "POST",
                                    { revision: artwork.revision, assetId },
                                  );
                                  await openArtwork(artwork.id);
                                  await loadArtworks();
                                  setNotice(
                                    "현재 revision의 치수·권리·출처와 파일을 검토 승인했습니다. 공개 배포는 별도 단계입니다.",
                                  );
                                })
                              }
                            >
                              현재 revision 검토 승인
                            </button>
                          )}
                          <button
                            disabled={
                              busy ||
                              artwork.approvedRevision !== artwork.revision
                            }
                            onClick={() => setPreview((value) => !value)}
                          >
                            전시용 미리보기
                          </button>
                          <button
                            disabled={busy || !assetId}
                            onClick={() => void downloadOriginal()}
                          >
                            원본 접근 확인
                          </button>
                          <button
                            disabled={busy || !assetId}
                            onClick={() =>
                              void action(async () => {
                                await request(
                                  `/api/v1/tenants/${session.tenantId}/assets/${assetId}/export-check`,
                                  session,
                                  "POST",
                                );
                                setNotice(
                                  "내보내기 권리 검사가 통과했습니다. 실제 OEX 파일 생성은 후속 단계입니다.",
                                );
                              })
                            }
                          >
                            내보내기 권리 확인
                          </button>
                        </div>
                        <p className="cms-note">
                          전시 허용은 원본 다운로드나 내보내기 허용을 뜻하지
                          않습니다. 원본 접근은 서버가 파일의 권리와 현재
                          유효기간을 별도로 검사합니다.
                        </p>
                        {preview && (
                          <ArtworkPreview
                            url={`${prefix}/artworks/${artwork.id}/preview`}
                            mime={
                              artwork.assets.find(
                                (a) => a.id === artwork.approvedAssetId,
                              )?.mime ?? ""
                            }
                            credit={artwork.metadata?.rights.creditLine ?? ""}
                          />
                        )}
                      </fieldset>
                      <fieldset>
                        <legend>변경 이력 비교</legend>
                        <label>
                          이전 revision
                          <select
                            aria-label="이전 revision"
                            value={compare?.revision ?? ""}
                            onChange={(e) =>
                              setCompare(
                                revisions.find(
                                  (r) => r.revision === Number(e.target.value),
                                ) ?? null,
                              )
                            }
                          >
                            <option value="">비교할 revision 선택</option>
                            {revisions.map((r) => (
                              <option key={r.revision} value={r.revision}>
                                revision {r.revision} · {r.createdAt}
                              </option>
                            ))}
                          </select>
                        </label>
                        {compare && (
                          <div className="cms-comparison">
                            <div>
                              <h3>이전 snapshot</h3>
                              <pre>
                                {JSON.stringify(compare.snapshot, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <h3>현재 입력 (미저장 포함)</h3>
                              <pre>{JSON.stringify(metadata, null, 2)}</pre>
                            </div>
                          </div>
                        )}
                        <p className="cms-note">
                          충돌 시 입력을 자동 덮어쓰지 않습니다. 이력을 비교한
                          뒤 서버 내용을 명시적으로 다시 읽으세요.
                        </p>
                      </fieldset>
                    </>
                  )}
                </section>
              ) : (
                <section className="cms-card">
                  <h2>작품을 선택하세요</h2>
                  <p>
                    치수, 권리, 출처와 승인 이력을 검토합니다. 작품은 비공개로
                    유지됩니다.
                  </p>
                </section>
              )}
            </div>
          )}
        </>
      )}
      <footer>
        인증된 개발용 CMS · 승인된 작품은 Studio에서 별도 검증 후 공개합니다. 계정 발급, 자동 worker 운영과 전체
        OES/OEX import는 별도 기능입니다.
      </footer>
    </main>
  );
}
