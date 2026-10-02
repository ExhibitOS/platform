// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from "react";
import { creationYearFor, experienceFor, curationFor } from "@exhibitos/studio-contract";
import type { PublicPublication } from "./publication-client";
import { ArtworkDetailPreview } from "./ArtworkDetailPreview";
import "./artwork-detail.css";
import { TimedTranscript } from "./TimedTranscript";
import type { VoicePlayback } from "./viewer/audio";

export function ArtworkDetail({ publication, placementId, onClose, onVoicePlay, onVoiceStop, renderPreview = true, voicePlayback = null }: {
  publication: PublicPublication; placementId: string; onClose(): void;
  renderPreview?: boolean; voicePlayback?: VoicePlayback | null;
  onVoicePlay(assetId: string): Promise<void>; onVoiceStop(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef(onClose), stop = useRef(onVoiceStop);
  close.current = onClose; stop.current = onVoiceStop;
  const voiceGeneration = useRef(0);
  const [voiceStatus, setVoiceStatus] = useState("");
  const placement = publication.exhibition.placements.find(p => p.id === placementId);
  const artwork = publication.exhibition.artworks.find(a => a.revisionId === placement?.artworkRevisionId);
  const experience = useMemo(() => experienceFor(publication.exhibition), [publication]);
  const curation = useMemo(() => curationFor(publication.exhibition), [publication]);
  const annotations = useMemo(() => publication.exhibition.annotations.filter(a => a.placementId === placementId), [publication, placementId]);
  const anchors = useMemo(() => annotations.flatMap(a => {
    const point = experience.annotations.find(p => p.annotationId === a.id);
    return point ? [{ id: a.id, text: a.text, position: point.position }] : [];
  }), [annotations, experience]);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { voiceGeneration.current++; stop.current(); element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  if (!artwork) return <dialog ref={dialog} className="artwork-detail" aria-label="작품 상세 보기 오류" onCancel={e => { e.preventDefault(); close.current(); }}>
    <p>선택한 작품을 이 공개 revision에서 확인할 수 없습니다.</p><button autoFocus onClick={onClose}>상세 보기 닫기</button>
  </dialog>;
  const description = publication.exhibition.accessibility.artworkDescriptions.find(a => a.placementId === placementId)?.text ?? artwork.metadata.description;
  const created = artwork.provenance.events.find(event => event.type === "created");
  const creationYear = creationYearFor(artwork) ?? created?.at.slice(0, 4);
  return <dialog ref={dialog} className="artwork-detail" aria-labelledby="artwork-detail-title" onCancel={e => { e.preventDefault(); close.current(); }}>
    <header><h2 id="artwork-detail-title">{artwork.metadata.title}</h2><button autoFocus onClick={onClose}>상세 보기 닫기</button></header>
    <p>{artwork.metadata.artist}</p>
    {renderPreview && <ArtworkDetailPreview publication={publication} artwork={artwork} anchors={anchors} />}
    <dl>
      <dt>실제 치수 (너비 × 높이 × 깊이)</dt><dd>{artwork.dimensions.width} × {artwork.dimensions.height} × {artwork.dimensions.depth ?? "미기록"} m</dd>
      <dt>재료·기법</dt><dd>{artwork.metadata.medium ?? "미기록"}</dd>
      <dt>제작 연도 (공개 제작 기록)</dt><dd data-testid="artwork-creation-year">{creationYear ?? "미기록"}</dd>
      <dt>권리자</dt><dd>{artwork.rights.holder}</dd><dt>권리·출처 표기</dt><dd>{artwork.rights.creditLine}</dd>
      <dt>라이선스</dt><dd>{artwork.rights.licenseId ?? artwork.rights.licenseText}</dd>
    </dl>
    <section aria-label="작가 원문"><h3>작가 원문 {artwork.metadata.language && `(${artwork.metadata.language})`}</h3><p className="detail-text">{description ?? "설명이 등록되지 않았습니다."}</p></section>
    {experience.translations.filter(t => t.placementId === placementId).map(t => <section key={t.locale} aria-label={`번역 ${t.locale}`} lang={t.locale}>
      <h3>번역 ({t.locale}) · {t.title}</h3><p className="detail-text">{t.description}</p><p>작가 원문과 구분된 번역문입니다.</p>
    </section>)}
    <section aria-label="작가 음성 및 대본"><h3>작가 음성 · 원문 대본</h3>
      {!renderPreview && <p>글·목록 관람에서는 음성을 요청하지 않습니다. 아래 대본으로 같은 설명을 읽을 수 있습니다.</p>}
      {experience.voices.filter(v => v.placementId === placementId).map(v => <div key={`${v.assetId}-${v.locale}`}>
        {renderPreview && <><button onClick={() => { const current = ++voiceGeneration.current; setVoiceStatus("음성을 확인합니다."); void onVoicePlay(v.assetId).then(() => { if (voiceGeneration.current === current) setVoiceStatus("음성을 재생합니다."); }).catch(() => { if (voiceGeneration.current === current) setVoiceStatus("음성을 재생할 수 없습니다. 대본을 읽어주세요."); }); }}>작가 음성 듣기 ({v.locale})</button>
        <button onClick={() => { voiceGeneration.current++; onVoiceStop(); setVoiceStatus("음성을 정지했습니다."); }}>음성 정지</button></>}
        <p lang={v.locale} className="detail-text">원문 대본 ({v.locale}): {v.transcript}</p>
        {curation.transcripts.filter(t=>t.placementId===placementId&&t.locale===v.locale).map(t=><TimedTranscript key={t.locale} transcript={t} assetId={v.assetId} playback={voicePlayback} />)}
      </div>)}
      {!experience.voices.some(v => v.placementId === placementId) && <p>등록된 작가 음성이 없습니다. 위 설명을 읽어주세요.</p>}
      <p role="status">{voiceStatus}</p>
    </section>
    <section aria-label="작품 공간 주석"><h3>작품 공간 주석</h3><p>{renderPreview ? "금색 점은 작품 중심을 원점으로 한 미터 좌표의 주석 위치입니다." : "주석 위치는 작품 중심을 원점으로 한 미터 좌표입니다."}</p>
      <ol>{annotations.map(a => { const anchor = anchors.find(p => p.id === a.id); return <li key={a.id}>{a.text} {anchor ? <span> · 위치 ({anchor.position.join(", ")}) m</span> : <span> · 좌표 미등록</span>}{curation.annotationTranslations.filter(t=>t.annotationId===a.id).map(t=><p key={t.locale} lang={t.locale}>별도 주석 번역 ({t.locale}): {t.text}</p>)}</li>; })}</ol>
    </section>
    <section aria-label="공개 provenance"><h3>공개 제작·전시 이력</h3><ul>{artwork.provenance.events.map(event => <li key={event.id}>{event.at} · {event.type} · {event.description}</li>)}</ul>
      <p>현재 공개 revision에 제공된 이력입니다. 비공개 원본·저장소·계정 정보는 요청하지 않습니다.</p>
    </section>
    <p>{renderPreview ? "상세 보기를 닫으면 전시의 기존 위치와 시점으로 돌아갑니다. 이전에 정지한 관람은 정지 상태를 유지합니다." : "상세 보기를 닫으면 선택한 작품의 목록으로 돌아갑니다."}</p>
  </dialog>;
}
