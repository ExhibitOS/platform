// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {watermarkFor,watermarkLabel} from '@exhibitos/studio-contract';
import './watermark-overlay.css';
/** Display-only annotation. No canvas readback, texture mutation or protection claim. */
export function WatermarkOverlay({candidate}:{candidate:Pick<Exhibition,'title'|'extensions'>}){
 const settings=watermarkFor(candidate);if(settings.mode!=='overlay')return null;
 return <span className="display-watermark" data-position={settings.position} role="note" aria-label="화면 워터마크" style={{fontSize:settings.size,opacity:settings.opacity}}>{watermarkLabel(candidate)}</span>;
}
