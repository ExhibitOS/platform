// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureURL } from '@exhibitos/spec';
import { expect, it } from 'vitest';
import { ArtworkDetail } from './ArtworkDetail';
import { ArtworkDetailPreview } from './ArtworkDetailPreview';
import { newDraft } from './drafts/example';
import { validateDraft } from './drafts/validator';
import type { PublicPublication } from './publication-client';

it('renders accepted mixed-case artwork, placement and annotation references without rewriting the publication', async () => {
  // Reuse the public synthetic scene. Letters make UUID case differences observable.
  let raw = await readFile(fixtureURL('oes/v1/examples/exhibition.json'), 'utf8');
  for (const [oldId, nextId] of [
    ['30000000-0000-4000-8000-000000000002', 'abcdefab-0000-4000-8000-000000000002'],
    ['50000000-0000-4000-8000-000000000042', 'abcdefab-0000-4000-8000-000000000042'],
    ['50000000-0000-4000-8000-000000000070', 'abcdefab-0000-4000-8000-000000000070'],
  ]) raw = raw.replaceAll(oldId!, nextId!);
  const draft = newDraft();
  draft.candidate = JSON.parse(raw);
  draft.exhibitionId = draft.candidate.id;
  const exhibition = draft.candidate, placement = exhibition.placements[2]!, artwork = exhibition.artworks[1]!, annotation = exhibition.annotations[0]!;
  placement.artworkRevisionId = artwork.revisionId.toUpperCase();
  exhibition.accessibility.artworkDescriptions[2]!.placementId = placement.id.toUpperCase();
  exhibition.accessibility.artworkDescriptions[2]!.text = 'Accessible synthetic original description';
  annotation.placementId = placement.id.toUpperCase();
  exhibition.extensions = { ...exhibition.extensions, 'org.exhibitos.viewer/experience': {
    version: 1, footsteps: [], voices: [], rooms: [],
    annotations: [{ annotationId: annotation.id.toUpperCase(), position: [0, 0, 0] }],
    translations: [{ placementId: placement.id.toUpperCase(), locale: 'en', title: 'Synthetic translated title', description: 'Separate synthetic translation' }],
  } };
  // This is an existing accepted document, not a fixture granted relaxed validation.
  expect(validateDraft(draft)).toEqual({ valid: true, errors: [] });
  const publication: PublicPublication = {
    publication: { id: 'abcdefab-0000-4000-8000-000000000090', revisionSha256: 'a'.repeat(64), publishedAt: '2026-10-19T00:00:00Z', status: 'published' },
    exhibition, assets: [],
  };
  const before = JSON.stringify(publication);
  // Uppercase caller ID also exercises direct selection from an equivalent reference.
  const html = renderToStaticMarkup(<ArtworkDetail publication={publication} placementId={placement.id.toUpperCase()} renderPreview={false} onClose={() => {}} onVoicePlay={async () => {}} onVoiceStop={() => {}} />);
  expect(html).not.toContain('작품 상세 보기 오류');
  expect(html).toContain(artwork.metadata.title);
  expect(html).toContain('Accessible synthetic original description');
  expect(html).toContain('기록된 크기');
  expect(html).toContain('너비 ');
  expect(html).toContain(' cm');
  expect(html).toContain(artwork.rights.creditLine);
  expect(html).toContain('Separate synthetic translation');
  expect(html).toContain(annotation.text);
  expect(html).toContain('(0, 0, 0) m');
  expect(html).not.toContain('좌표 미등록');
  expect(html).toContain('aria-label="작품 설명"');
  const withPreview=renderToStaticMarkup(<ArtworkDetail publication={publication} placementId={placement.id} renderPreview onClose={() => {}} onVoicePlay={async () => {}} onVoiceStop={() => {}} />);
  expect(withPreview).toMatch(/<details class="artwork-detail-record" aria-label="작품 설명" open=""/);
  expect(html).toContain('음성 설명 · 대본');
  expect(html).toContain('등록된 작품 음성 설명이 없습니다.');
  expect(html).not.toContain('작가 원문');
  expect(html).not.toContain('작가 음성');
  expect(html).not.toContain('아래 대본으로 같은 설명');
  expect(html).not.toContain('<canvas');
  const preview = renderToStaticMarkup(<ArtworkDetailPreview publication={publication} artwork={artwork} anchors={[]} />);
  expect(preview).toContain('tabindex="0"');
  expect(preview).toContain('aria-label="작품 이미지 확대 및 이동 조작"');
  expect(preview).toContain('aria-describedby=');
  expect(preview).toContain('전체 보기');
  expect(preview).toContain('이미지 조작 안내');
  expect(preview).not.toContain('작품 상하 회전');
  expect(preview).not.toContain('<canvas');
  const sculpturePreview=renderToStaticMarkup(<ArtworkDetailPreview publication={publication} artwork={{...artwork,artworkType:'sculpture'}} anchors={[]} />);
  expect(sculpturePreview).toContain('aria-label="작품 회전 및 확대 조작"');
  expect(sculpturePreview).toContain('aria-label="작품 상하 회전"');
  expect(sculpturePreview).toContain('min="-90" max="90"');
  expect(sculpturePreview).toContain('aria-label="작품 회전"');
  expect(sculpturePreview).toContain('aria-label="작품 확대"');
  expect(sculpturePreview).toContain('상세 시점 초기화');
  expect(JSON.stringify(publication)).toBe(before);
});
