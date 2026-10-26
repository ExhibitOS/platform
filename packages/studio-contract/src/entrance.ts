// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MaterialValidation } from './index.js';
import {validateEntranceDesign,type ViewerEntranceDesign} from './entrance-design.js';

export const ENTRANCE_NAMESPACE = 'org.exhibitos.viewer/entrance';
export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export interface ViewerEntryPresentation {
  ticketTitle: string;
  ticketDetail: string;
  ticketAnimation: boolean;
  coverUnfold: boolean;
  doorEffect: boolean;
}
export interface ViewerEntrance {
  version: 1;
  artist: string;
  introduction: string;
  imageAssetId?: string;
  imageAlt: string;
  mobilePosition: 'center' | 'top' | 'bottom';
  presentation?: ViewerEntryPresentation;
  design?: ViewerEntranceDesign;
}
const presentationDefaults: ViewerEntryPresentation = { ticketTitle: '', ticketDetail: '', ticketAnimation: true, coverUnfold: true, doorEffect: true };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const defaults: ViewerEntrance = { version: 1, artist: '', introduction: '', imageAlt: '', mobilePosition: 'center' };

/** Public prose and one existing approved PNG; never an arbitrary URL or private asset. */
export function validateViewerEntrance(candidate: unknown): MaterialValidation {
  const errors: MaterialValidation['errors'] = [];
  const fail = (message: string) => errors.push({ code: 'VIEWER_ENTRANCE_INVALID', path: '/candidate/extensions/org.exhibitos.viewer~1entrance', message });
  if (!object(candidate) || !object(candidate.extensions) || !Object.hasOwn(candidate.extensions, ENTRANCE_NAMESPACE)) return { valid: true, errors };
  const value = candidate.extensions[ENTRANCE_NAMESPACE];
  if (!object(value)) { fail('Expected entrance version 1'); return { valid: false, errors }; }
  const keys = ['version', 'artist', 'introduction', 'imageAlt', 'mobilePosition', ...(value.imageAssetId === undefined ? [] : ['imageAssetId']), ...(value.presentation === undefined ? [] : ['presentation']), ...(value.design === undefined ? [] : ['design'])];
  if (value.version !== 1 || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      typeof value.artist !== 'string' || value.artist.length > 512 ||
      typeof value.introduction !== 'string' || value.introduction.length > 4096 ||
      typeof value.imageAlt !== 'string' || value.imageAlt.length > 2048 ||
      typeof value.mobilePosition !== 'string' || !['center', 'top', 'bottom'].includes(value.mobilePosition)) {
    fail('Expected bounded public artist, introduction, image description and mobile position');
    return { valid: false, errors };
  }
  if (value.presentation !== undefined) {
    const p = value.presentation;
    if (!object(p) || Object.keys(p).sort().join(',') !== 'coverUnfold,doorEffect,ticketAnimation,ticketDetail,ticketTitle' ||
        typeof p.ticketTitle !== 'string' || p.ticketTitle.length > 160 ||
        typeof p.ticketDetail !== 'string' || p.ticketDetail.length > 512 ||
        typeof p.ticketAnimation !== 'boolean' || typeof p.coverUnfold !== 'boolean' || typeof p.doorEffect !== 'boolean') {
      fail('Expected bounded public ticket text and three independent boolean presentation effects');
    }
  }
  if(value.design!==undefined){const design=validateEntranceDesign(value.design);errors.push(...design.errors);}
  if (value.imageAssetId !== undefined) {
    const id = value.imageAssetId;
    const artworks = Array.isArray(candidate.artworks) ? candidate.artworks.filter(object) : [];
    const matches = artworks.flatMap(artwork => (Array.isArray(artwork.assets) ? artwork.assets.filter(object) : [])
      .filter(asset => typeof id === 'string' && typeof asset.id === 'string' && asset.id.toLowerCase() === id.toLowerCase())
      .map(asset => ({ artwork, asset })));
    const selected = matches[0];
    if (typeof id !== 'string' || !uuid.test(id) || !value.imageAlt.trim() || matches.length !== 1 ||
        !selected || selected.artwork.artworkType !== 'image' || typeof selected.artwork.primaryAssetId !== 'string' ||
        selected.artwork.primaryAssetId.toLowerCase() !== id.toLowerCase() || selected.asset.role !== 'image' || selected.asset.mime !== 'image/png' ||
        !Number.isSafeInteger(selected.asset.bytes) || Number(selected.asset.bytes) < 1 || Number(selected.asset.bytes) > MAX_COVER_BYTES) {
      fail('Cover must uniquely reference a primary PNG artwork asset up to 8 MiB with a nonempty description');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function entranceFor(candidate: { extensions?: unknown; artworks?: unknown }): ViewerEntrance {
  if (!validateViewerEntrance(candidate).valid) throw Error('VIEWER_ENTRANCE_INVALID');
  const value = object(candidate.extensions) ? candidate.extensions[ENTRANCE_NAMESPACE] : undefined;
  return structuredClone((value as ViewerEntrance | undefined) ?? defaults);
}

/** Absence keeps legacy documents unchanged; callers receive fresh authored defaults.
 * Empty ticket text falls back to the exhibition title / entrance artist in the UI.
 * Visitor reduced motion suppresses effects without rewriting this metadata. */
export function entryPresentationFor(candidate: { extensions?: unknown; artworks?: unknown }): ViewerEntryPresentation {
  return structuredClone(entranceFor(candidate).presentation ?? presentationDefaults);
}
