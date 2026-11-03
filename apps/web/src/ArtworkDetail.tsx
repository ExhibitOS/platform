// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from "react";
import { creationYearFor, experienceFor, curationFor, formatArtworkDimensions } from "@exhibitos/studio-contract";
import type { PublicPublication } from "./publication-client";
import { ArtworkDetailPreview } from "./ArtworkDetailPreview";
import "./artwork-detail.css";
import {ViewerIcon} from "./viewer/ViewerIcon";
import { TimedTranscript } from "./TimedTranscript";
import type { VoicePlayback } from "./viewer/audio";
import type {SharedDetailPreview} from './viewer/borrowed-detail-preview';

// UUID references are case-insensitive in the accepted public document.
const sameId = (a: string, b: string | undefined) => b !== undefined && a.toLowerCase() === b.toLowerCase();

export function ArtworkDetail({ publication, placementId, onClose, onVoicePlay, onVoiceStop, renderPreview = true, voicePlayback = null,sharedPreview }: {
  publication: PublicPublication; placementId: string; onClose(): void;
  renderPreview?: boolean; voicePlayback?: VoicePlayback | null;
  sharedPreview?:SharedDetailPreview;
  onVoicePlay(assetId: string): Promise<void>; onVoiceStop(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef(onClose), stop = useRef(onVoiceStop);
  close.current = onClose; stop.current = onVoiceStop;
  const voiceGeneration = useRef(0);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voicePending,setVoicePending]=useState<string|null>(null);
  const placement = publication.exhibition.placements.find(p => sameId(p.id, placementId));
  const artwork = publication.exhibition.artworks.find(a => sameId(a.revisionId, placement?.artworkRevisionId));
  const experience = useMemo(() => experienceFor(publication.exhibition), [publication]);
  const curation = useMemo(() => curationFor(publication.exhibition), [publication]);
  const annotations = useMemo(() => publication.exhibition.annotations.filter(a => sameId(a.placementId, placementId)), [publication, placementId]);
  const anchors = useMemo(() => annotations.flatMap(a => {
    const point = experience.annotations.find(p => sameId(p.annotationId, a.id));
    return point ? [{ id: a.id, text: a.text, position: point.position }] : [];
  }), [annotations, experience]);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { voiceGeneration.current++; stop.current(); element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  if (!artwork) return <dialog ref={dialog} className="artwork-detail" aria-label="작품 상세 보기 오류" onCancel={e => { e.preventDefault(); close.current(); }}>
    <header><button autoFocus className="viewer-guide-close artwork-detail-close" aria-label="전시로 돌아가기" title="전시로 돌아가기" onClick={onClose}><ViewerIcon name="close"/></button></header><div className="artwork-detail-body"><p>선택한 작품을 이 전시에서 확인할 수 없어요. 전시로 돌아가 다른 작품을 선택해 주세요.</p></div>
  </dialog>;
  const description = publication.exhibition.accessibility.artworkDescriptions.find(a => sameId(a.placementId, placementId))?.text ?? artwork.metadata.description;
  const created = artwork.provenance.events.find(event => event.type === "created");
  const creationYear = creationYearFor(artwork) ?? created?.at.slice(0, 4);
  const voices=experience.voices.filter(v=>sameId(v.placementId,placementId));
  const translations=experience.translations.filter(t=>sameId(t.placementId,placementId));
  const requestVoice=(assetId:string)=>{
    const current=++voiceGeneration.current;setVoicePending(assetId);setVoiceStatus("");
    void (async()=>{try{await onVoicePlay(assetId);}catch{if(voiceGeneration.current===current)setVoiceStatus("음성 설명을 재생할 수 없어요. 대본을 읽어 주세요.");}finally{if(voiceGeneration.current===current)setVoicePending(null);}})();
  };
  const stopVoice=()=>{voiceGeneration.current++;setVoicePending(null);onVoiceStop();setVoiceStatus("음성 설명을 정지했어요.");};
  const currentVoice=voices.some(v=>sameId(v.assetId,voicePlayback?.assetId??undefined));
  const playbackStatus=voiceStatus||(voicePending?"음성 설명을 준비하고 있어요.":currentVoice&&voicePlayback?.status==='playing'?"음성 설명 재생 중":currentVoice&&voicePlayback?.status==='unavailable'?"음성 설명을 재생할 수 없어요. 대본을 읽어 주세요.":currentVoice&&voicePlayback?.status==='ended'?"음성 설명을 끝까지 들었어요.":currentVoice&&voicePlayback?.status==='stopped'?"음성 설명을 정지했어요.":"");
  return <dialog ref={dialog} className="artwork-detail" data-with-preview={renderPreview} aria-labelledby="artwork-detail-title" onCancel={e => { e.preventDefault(); close.current(); }}>
    <header><button autoFocus className="viewer-guide-close artwork-detail-close" aria-label="전시로 돌아가기" title="전시로 돌아가기" onClick={onClose}><ViewerIcon name="close"/></button></header>
    <div className="artwork-detail-body">
      {renderPreview&&<div className="artwork-detail-media"><ArtworkDetailPreview publication={publication} artwork={artwork} anchors={anchors} placementId={placementId} sharedPreview={sharedPreview}/></div>}
      <div className="artwork-detail-content">
        <h2 id="artwork-detail-title">{artwork.metadata.title}</h2>
        <p className="artwork-detail-artist">{artwork.metadata.artist}</p>
        <dl className="artwork-detail-facts">
          {creationYear&&<><dt>제작 연도</dt><dd data-testid="artwork-creation-year">{creationYear}</dd></>}
          {artwork.metadata.medium&&<><dt>재료·기법</dt><dd>{artwork.metadata.medium}</dd></>}
          <dt>기록된 크기</dt><dd>{formatArtworkDimensions(artwork.dimensions)}</dd>
        </dl>
        <section aria-label="작품 설명"><h3>작품 설명</h3><p className="detail-text">{description??"설명이 등록되지 않았습니다."}</p></section>
        {voices.length>0&&<section className="artwork-detail-voices" aria-label="작품 음성 설명"><h3>음성 설명</h3>
          {!renderPreview&&<p>글·목록 관람에서는 음성을 요청하지 않습니다. 대본을 읽을 수 있어요.</p>}
          {voices.map(v=>{const playing=sameId(v.assetId,voicePlayback?.assetId??undefined)&&voicePlayback?.status==='playing';return <div key={`${v.assetId}-${v.locale}`} className="artwork-detail-voice" role="group" aria-label={`음성 설명 (${v.locale})`}>
            {renderPreview&&<div className="artwork-detail-voice-controls"><button type="button" className="viewer-secondary-icon" aria-label={`음성 설명 재생 (${v.locale})`} title={`음성 설명 재생 (${v.locale})`} disabled={!!voicePending||playing} aria-busy={voicePending===v.assetId} onClick={()=>requestVoice(v.assetId)}><ViewerIcon name="play"/></button><button type="button" className="viewer-secondary-icon" aria-label={`음성 설명 정지 (${v.locale})`} title={`음성 설명 정지 (${v.locale})`} disabled={!playing&&voicePending!==v.assetId} onClick={stopVoice}><ViewerIcon name="stop"/></button><span>{v.locale}</span></div>}
            <details className="artwork-detail-record" open={!renderPreview}><summary>대본 ({v.locale})</summary><p lang={v.locale} className="detail-text">{v.transcript}</p>{curation.transcripts.filter(t=>sameId(t.placementId,placementId)&&t.locale===v.locale).map(t=><TimedTranscript key={t.locale} transcript={t} assetId={v.assetId} playback={voicePlayback}/>)}</details>
          </div>;})}
          {renderPreview&&<p role="status">{playbackStatus}</p>}
        </section>}
        {translations.map(t=><details key={t.locale} className="artwork-detail-record"><summary>번역 ({t.locale})</summary><section aria-label={`번역 ${t.locale}`} lang={t.locale}><h3>{t.title}</h3><p className="detail-text">{t.description}</p><p>작품 설명과 구분된 번역문입니다.</p></section></details>)}
        <section className="artwork-detail-rights" aria-label="권리·출처"><h3>권리·출처</h3><dl><dt>권리자</dt><dd>{artwork.rights.holder}</dd><dt>권리·출처 표기</dt><dd>{artwork.rights.creditLine}</dd><dt>라이선스</dt><dd>{artwork.rights.licenseId??artwork.rights.licenseText}</dd></dl></section>
        {annotations.length>0&&<details className="artwork-detail-record"><summary>작품 주석 ({annotations.length})</summary><section aria-label="작품 공간 주석"><ol>{annotations.map(a=>{const anchor=anchors.find(p=>sameId(p.id,a.id));return <li key={a.id}>{a.text} {anchor?<details className="artwork-annotation-position"><summary>작품 안의 위치</summary><span>작품 중심에서 ({anchor.position.join(", ")}) m</span></details>:<span> · 좌표 미등록</span>}{curation.annotationTranslations.filter(t=>sameId(t.annotationId,a.id)).map(t=><p key={t.locale} lang={t.locale}>별도 주석 번역 ({t.locale}): {t.text}</p>)}</li>;})}</ol></section></details>}
        {artwork.provenance.events.length>0&&<details className="artwork-detail-record"><summary>작품의 제작·전시 이력</summary><section aria-label="공개 provenance"><ul>{artwork.provenance.events.map(event=><li key={event.id}>{event.at} · {event.type} · {event.description}</li>)}</ul><p>현재 공개된 작품의 이력입니다. 비공개 원본·저장소·계정 정보는 요청하지 않습니다.</p></section></details>}
      </div>
    </div>
  </dialog>;
}
