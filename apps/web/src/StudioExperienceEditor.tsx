// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import type { Exhibition, JsonValue } from "@exhibitos/spec";
import { EXPERIENCE_NAMESPACE, experienceFor, validateViewerExperience, type ViewerExperience } from "@exhibitos/studio-contract";
import { VoiceRecorder } from "./VoiceRecorder";
import { failureMessage, request, type Session, type Rights } from "./cms-client";
type Media = Exhibition["mediaAssets"][number];
interface AudioItem { id: string; state: "uploading" | "validated" | "approved"; revision: 1; revoked: boolean; durationSeconds: number | null; mediaAsset: Media }
export function StudioExperienceEditor({ candidate, session, exhibitionId, disabled, onChange }: {
  candidate: Exhibition; session: Session | null; exhibitionId?: string; disabled: boolean; onChange: (value: Exhibition) => void;
}) {
  const latest = useRef(candidate); latest.current = candidate;
  const context = `${session?.tenantId}:${session?.userId}:${exhibitionId}`;
  const liveContext = useRef(context); liveContext.current = context;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [items, setItems] = useState<AudioItem[]>([]);
  const [file, setFile] = useState<File | null>(null), [holder, setHolder] = useState(""), [credit, setCredit] = useState(""), [license, setLicense] = useState(""), [display, setDisplay] = useState(false);
  const [placementId, setPlacementId] = useState(""), [audioId, setAudioId] = useState(""), [transcript, setTranscript] = useState(""), [locale, setLocale] = useState("ko");
  const [surfaceId, setSurfaceId] = useState(""), [material, setMaterial] = useState<ViewerExperience["footsteps"][number]["material"]>("concrete");
  const [roomId, setRoomId] = useState(""), [reverb, setReverb] = useState(.2);
  const [radius, setRadius] = useState(3), [volume, setVolume] = useState(.8);
  const [annotation, setAnnotation] = useState(""), [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [translatedTitle, setTranslatedTitle] = useState(""), [translatedDescription, setTranslatedDescription] = useState("");
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  const base = session && exhibitionId ? `/api/v1/tenants/${session.tenantId}/studio/exhibitions/${exhibitionId}/audio` : null;
  useEffect(() => { setItems([]); setAudioId(""); attempt.current = null; }, [context]);
  function change(edit: (doc: Exhibition, experience: ViewerExperience) => void) {
    if (disabled || busy) return;
    const doc = structuredClone(latest.current), experience = experienceFor(doc);
    edit(doc, experience);
    doc.extensions = { ...doc.extensions, [EXPERIENCE_NAMESPACE]: experience as unknown as { [key: string]: JsonValue } };
    const result = validateViewerExperience(doc);
    if (!result.valid) { setNotice("참조·위치·언어 또는 입력 한도를 확인하세요. 현재 전시 문서는 유지됩니다."); return; }
    onChange(doc); setNotice("관람 설정을 현재 입력에 적용했습니다. 로컬 및 서버에 저장한 뒤 공개하세요.");
  }
  async function work(fn: () => Promise<void>) {
    if (busyRef.current || disabled) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try { await fn(); } catch (error) { if (mounted.current && liveContext.current === context) setNotice(failureMessage(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    if (!base || !session) return;
    const value = await request<{ items: AudioItem[] }>(base, session);
    if (mounted.current && liveContext.current === context) setItems(value.items);
  }
  async function upload() {
    if (!base || !session || !file || !display || !holder.trim() || !credit.trim() || !license.trim()) return;
    if (file.size < 1 || file.size > 12582912) throw Error("WAV 파일은 12 MiB 이하여야 합니다.");
    const bytes = await file.arrayBuffer(), hash = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
    const rights: Rights = { holder: holder.trim(), ownership: "owner", licenseId: license.trim(), creditLine: credit.trim(), permissions: { display: true, download: false, export: false, commercial: false } };
    const signature = JSON.stringify({ context, sha256, rights });
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    const created = await request<AudioItem>(base, session, "POST", { requestId: attempt.current.requestId, mime: "audio/wav", bytes: bytes.byteLength, sha256, rights });
    if (created.state === "uploading") await request<AudioItem>(`${base}/${created.id}/bytes`, session, "PUT", bytes);
    if (!mounted.current || liveContext.current !== context) return;
    await refresh(); setAudioId(created.id); setNotice("오디오 파일 검증을 완료했습니다. 권리를 확인하고 별도로 승인하세요.");
  }
  const experience = experienceFor(candidate);
  return <section className="cms-card" aria-label="관람 오디오와 작품 설명 편집">
    <h3>관람 오디오와 작품 설명</h3>
    <p>소리는 관람자가 직접 켠 뒤 재생됩니다. 설명과 번역 원문은 소리 없이 읽을 수 있습니다.</p>
    <p role="status">{notice}</p>
    <VoiceRecorder disabled={disabled || busy} onRecorded={setFile} />
    {file && <p>준비한 파일: {file.name} · {file.size} bytes</p>}
    <fieldset disabled={disabled || busy}>
      <legend>전시 오디오 업로드와 권리</legend>
      {!base && <p>CMS 로그인 후 이 전시를 서버에 저장하면 오디오를 업로드할 수 있습니다. 로컬 설명 편집은 계속할 수 있습니다.</p>}
      <label>작가 음성 WAV 파일<input aria-label="작가 음성 WAV 파일" type="file" accept=".wav,audio/wav" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <p>PCM 16비트, 1–2채널, 8–48 kHz, 60초·12 MiB 이하. 현재 MP3/OGG 업로드는 지원하지 않습니다.</p>
      <label>오디오 권리자<input value={holder} onChange={e => setHolder(e.target.value)} maxLength={512} /></label>
      <label>오디오 크레딧<input value={credit} onChange={e => setCredit(e.target.value)} maxLength={2048} /></label>
      <label>오디오 라이선스 식별자<input value={license} onChange={e => setLicense(e.target.value)} maxLength={512} /></label>
      <label><input type="checkbox" checked={display} onChange={e => setDisplay(e.target.checked)} />이 녹음의 권리자로서 공개 재생을 허용합니다</label>
      <button disabled={!base || !file || !display || !holder.trim() || !credit.trim() || !license.trim()} onClick={() => void work(upload)}>오디오 업로드·검증</button>
      <button disabled={!base} onClick={() => void work(refresh)}>전시 오디오 목록 새로고침</button>
      <ul>{items.map(item => <li key={item.id}>
        <span>{item.mediaAsset.rights.creditLine} · {item.state}{item.revoked ? " · 공개 재생 철회" : ""}</span>
        {item.state === "validated" && <button onClick={() => void work(async () => { if (!base || !session) return; await request(`${base}/${item.id}/approve`, session, "POST", { revision: 1 }); await refresh(); setNotice("오디오 승인 완료. 작품 음성 또는 공간 오디오에 연결하세요."); })}>오디오 승인</button>}
        {item.state === "approved" && <button onClick={() => void work(async () => { if (!base || !session) return; await request(`${base}/${item.id}/${item.revoked ? "restore" : "revoke"}`, session, "POST", {}); await refresh(); })}>{item.revoked ? "오디오 공개 재생 복원" : "오디오 공개 재생 철회"}</button>}
      </li>)}</ul>
    </fieldset>
    <fieldset disabled={disabled || busy}>
      <legend>작품 음성·읽기 설명·번역·위치 설명</legend>
      <label>설명할 작품 배치<select value={placementId} onChange={e => setPlacementId(e.target.value)}><option value="">작품 선택</option>{candidate.placements.map(p => <option key={p.id} value={p.id}>{candidate.artworks.find(a => a.revisionId === p.artworkRevisionId)?.metadata.title ?? p.id}</option>)}</select></label>
      <label>승인된 오디오<select value={audioId} onChange={e => setAudioId(e.target.value)}><option value="">오디오 선택</option>{items.filter(a => a.state === "approved" && !a.revoked).map(a => <option value={a.id} key={a.id}>{a.mediaAsset.rights.creditLine}</option>)}</select></label>
      <label>설명 언어<input value={locale} onChange={e => setLocale(e.target.value)} maxLength={48} /></label>
      <label>음성 대본<textarea value={transcript} onChange={e => setTranscript(e.target.value)} maxLength={16384} /></label>
      <button disabled={!placementId || !audioId || !transcript.trim()} onClick={() => change((doc, x) => {
        const item = items.find(i => i.id === audioId && i.state === "approved" && !i.revoked), placement = doc.placements.find(p => p.id === placementId);
        if (!item || !placement) return;
        if (!doc.mediaAssets.some(a => a.id === item.id)) doc.mediaAssets.push(structuredClone(item.mediaAsset));
        x.voices = x.voices.filter(v => !(v.placementId === placementId && v.locale.toLowerCase() === locale.toLowerCase()));
        x.voices.push({ placementId, assetId: item.id, transcript, locale });
      })}>작품 음성 연결</button>
      <label>공간 오디오 반경 (m)<input type="number" min="0.1" max="100" step="0.1" value={radius} onChange={e => setRadius(Number(e.target.value))} /></label>
      <label>공간 오디오 음량<input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
      <button disabled={!placementId || !audioId || !transcript.trim() || !Number.isFinite(radius) || radius <= 0 || radius > 100} onClick={() => change((doc) => {
        const item = items.find(i => i.id === audioId && i.state === "approved" && !i.revoked), placement = doc.placements.find(p => p.id === placementId);
        if (!item || !placement) return;
        if (!doc.mediaAssets.some(a => a.id === item.id)) doc.mediaAssets.push(structuredClone(item.mediaAsset));
        doc.audioZones.push({ id: crypto.randomUUID(), roomId: placement.roomId, assetId: item.id, position: structuredClone(placement.transform.position), radius, volume, autoplay: false, transcript });
      })}>작품 위치에 공간 오디오 추가</button>
      <label>추가 위치 설명<textarea value={annotation} onChange={e => setAnnotation(e.target.value)} maxLength={16384} /></label>
      <p>작품 중심을 원점으로 하는 실제 미터 좌표입니다.</p>
      {position.map((v, i) => <label key={i}>설명 위치 {"XYZ"[i]}<input type="number" step="0.01" value={v} onChange={e => setPosition(position.map((n, j) => j === i ? Number(e.target.value) : n) as [number, number, number])} /></label>)}
      <button disabled={!placementId || !annotation.trim()} onClick={() => change((doc, x) => { const id = crypto.randomUUID(); doc.annotations.push({ id, placementId, text: annotation }); x.annotations.push({ annotationId: id, position }); })}>위치 설명 추가</button>
      <label>번역 제목<input value={translatedTitle} onChange={e => setTranslatedTitle(e.target.value)} maxLength={512} /></label>
      <label>번역 설명<textarea value={translatedDescription} onChange={e => setTranslatedDescription(e.target.value)} maxLength={16384} /></label>
      <button disabled={!placementId || !translatedTitle.trim() || !translatedDescription.trim()} onClick={() => change((_doc, x) => { x.translations = x.translations.filter(t => !(t.placementId === placementId && t.locale.toLowerCase() === locale.toLowerCase())); x.translations.push({ placementId, locale, title: translatedTitle, description: translatedDescription }); })}>번역 추가·갱신</button>
      <p>번역은 작가 원문과 구분해 표시합니다. 원래 작품 설명을 덮어쓰지 않습니다.</p>
      <p>작품 음성 {experience.voices.length} · 위치 설명 {experience.annotations.length} · 번역 {experience.translations.length}</p>
    </fieldset>
    <fieldset disabled={disabled || busy}>
      <legend>바닥 소리와 공간 울림</legend>
      <label>발소리 바닥<select value={surfaceId} onChange={e => setSurfaceId(e.target.value)}><option value="">바닥 선택</option>{candidate.surfaces.filter(s => s.type === "floor").map(s => <option key={s.id} value={s.id}>{candidate.rooms.find(r => r.id === s.roomId)?.name ?? s.id}</option>)}</select></label>
      <label>발소리 재질<select value={material} onChange={e => setMaterial(e.target.value as typeof material)}>{["wood", "stone", "concrete", "carpet", "metal"].map(m => <option key={m}>{m}</option>)}</select></label>
      <button disabled={!surfaceId} onClick={() => change((_doc, x) => { x.footsteps = x.footsteps.filter(f => f.surfaceId !== surfaceId); x.footsteps.push({ surfaceId, material }); })}>바닥 발소리 적용</button>
      <label>울림 공간<select value={roomId} onChange={e => setRoomId(e.target.value)}><option value="">공간 선택</option>{candidate.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>공간 울림<input type="range" min="0" max="1" step="0.05" value={reverb} onChange={e => setReverb(Number(e.target.value))} /></label>
      <button disabled={!roomId} onClick={() => change((_doc, x) => { x.rooms = x.rooms.filter(r => r.roomId !== roomId); x.rooms.push({ roomId, reverb }); })}>공간 울림 적용</button>
    </fieldset>
  </section>;
}
