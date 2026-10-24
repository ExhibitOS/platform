// SPDX-License-Identifier: AGPL-3.0-or-later
/** Display policy only; authored camera coordinates and FOV remain unchanged. */
export function visitingFov(authored: number, preferred: number | undefined, aspect: number) {
  if (preferred === undefined) return authored;
  const vertical = Math.min(authored, preferred);
  // Keep each choice distinct on wide windows using its 16:9 horizontal framing.
  // This is a bounded display choice, not a universal comfort/safety threshold.
  const horizontal = Math.min(84, 2 * Math.atan(Math.tan(vertical * Math.PI / 360) * 16 / 9) * 180 / Math.PI);
  return Math.min(vertical, 2 * Math.atan(Math.tan(horizontal * Math.PI / 360) / aspect) * 180 / Math.PI);
}

/** Full-HD-class desktop ceiling; larger displays stay bounded, not native. */
export const DESKTOP_VISITING_PIXELS = 1920 * 1080;

/** Stable per-profile budgets; compact retains its former document-view cost. */
export function visitingBuffer(width: number, height: number, preferredRatio: number, compact = false) {
  const legacyWidth = Math.max(1, Math.min(width, 1440) - (width <= 600 ? 48 : 96));
  const pixelBudget = compact
    ? legacyWidth * 360 * preferredRatio ** 2
    : Math.min(DESKTOP_VISITING_PIXELS, width * height * preferredRatio ** 2);
  return {pixelBudget, ratio: Math.min(preferredRatio, Math.sqrt(pixelBudget / (width * height)))};
}
