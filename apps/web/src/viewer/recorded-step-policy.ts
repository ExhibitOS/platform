// SPDX-License-Identifier: AGPL-3.0-or-later
// Metadata policy; existing StrideClock remains the only movement trigger.
export const RECORDED_STEP_LIMITS = Object.freeze({ maxSamples: 16, maxIdLength: 128,
  minClipSeconds: 0.04, maxClipSeconds: 1.5, maxSourceSeconds: 60 });

export interface VerifiedStepSample {
  id: string;
  /** Actual caller-verified decoded duration, never extension/filename inference. */
  durationSeconds: number;
  verified: true;
  /** Optional explicitly reviewed isolated step within a longer recording. */
  segment?: { startSeconds: number; endSeconds: number; naturalBoundaryVerified: true };
}
export interface StepConditions {
  visitorFootstepsEnabled: boolean;
  enabled: boolean; muted: boolean; visible: boolean; audible: boolean;
  detail: boolean; contextRunning: boolean; voicePlaying: boolean;
}
export interface StepHistory { previousId?: string; nextSide: "left" | "right" }
export interface StepRandom { selection: number; gain: number; rate: number }
export interface RecordedStepPlan {
  sampleId: string;
  offsetSeconds: number;
  /** Media seconds passed as source.start duration; playbackRate changes wall time. */
  mediaDurationSeconds: number;
  playbackRate: number;
  wallDurationSeconds: number;
  peakGain: number;
  fadeInSeconds: number;
  fadeOutStartSeconds: number;
  fadeOutSeconds: number;
  /** Metadata only: no stereo pan or position is assigned by this policy. */
  side: "left" | "right";
  nextHistory: StepHistory;
}
export type StepDecision = { play: false; reason: "visitor-off" | "inaudible" | "invalid-samples" | "empty" }
  | { play: true; plan: RecordedStepPlan };

function unit(value: number): number {
  return Number.isNaN(value) ? 0.5 : Math.max(0, Math.min(1, value));
}

/** One lazy draw per material/bank/revision in one viewing runtime. Failed
 * recordings advance through that fixed order once; pauses never reset it. */
export class RecordedStepSession {
  private banks = new Map<string, { order: string[]; index: number }>();
  select(key: string, ids: readonly string[], random: () => number): string | undefined {
    let bank = this.banks.get(key);
    if (!bank) {
      const validIds = ids.length <= RECORDED_STEP_LIMITS.maxSamples && new Set(ids).size === ids.length &&
        ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= RECORDED_STEP_LIMITS.maxIdLength);
      const start = validIds && ids.length > 1 ? Math.min(ids.length - 1, Math.floor(unit(random()) * ids.length)) : 0;
      const order = validIds ? [...ids.slice(start), ...ids.slice(0, start)] : [];
      bank = { order, index: 0 }; this.banks.set(key, bank);
    }
    return bank.order[bank.index];
  }
  failed(key: string, id: string) {
    const bank = this.banks.get(key);
    if (bank?.order[bank.index] === id) bank.index++;
  }
}
function valid(sample: VerifiedStepSample): boolean {
  if (!sample || sample.verified !== true || typeof sample.id !== "string" ||
    sample.id.length === 0 || sample.id.length > RECORDED_STEP_LIMITS.maxIdLength ||
    !Number.isFinite(sample.durationSeconds) || sample.durationSeconds <= 0 ||
    sample.durationSeconds > RECORDED_STEP_LIMITS.maxSourceSeconds) return false;
  const segment = sample.segment;
  if (segment && (segment.naturalBoundaryVerified !== true ||
    !Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds) ||
    segment.startSeconds < 0 || segment.endSeconds > sample.durationSeconds)) return false;
  const duration = segment ? segment.endSeconds - segment.startSeconds : sample.durationSeconds;
  return duration >= RECORDED_STEP_LIMITS.minClipSeconds && duration <= RECORDED_STEP_LIMITS.maxClipSeconds;
}

/** Call only after existing StrideClock.advance has returned true. No source/timer/fetch is created.
 * Reject the whole supplied set on invalid/duplicate metadata; do not silently repair boundaries.
 * Caller retains provenance/review records, verified asset loading and all existing memory limits.
 */
export function recordedStepPolicy(samples: readonly VerifiedStepSample[], conditions: StepConditions,
  history: StepHistory, random: StepRandom): StepDecision {
  if (!conditions.visitorFootstepsEnabled) return { play: false, reason: "visitor-off" };
  if (!conditions.enabled || conditions.muted || !conditions.visible || !conditions.audible ||
    conditions.detail || !conditions.contextRunning) return { play: false, reason: "inaudible" };
  if (samples.length > RECORDED_STEP_LIMITS.maxSamples) return { play: false, reason: "invalid-samples" };
  if (samples.length === 0) return { play: false, reason: "empty" };
  const ids = new Set<string>();
  for (const sample of samples) {
    if (!valid(sample) || ids.has(sample.id)) return { play: false, reason: "invalid-samples" };
    ids.add(sample.id);
  }
  const index = Math.min(samples.length - 1, Math.floor(unit(random.selection) * samples.length));
  const sample = samples.find(sample => sample.id === history.previousId) ?? samples[index]!;
  const offsetSeconds = sample.segment?.startSeconds ?? 0;
  const mediaDurationSeconds = (sample.segment?.endSeconds ?? sample.durationSeconds) - offsetSeconds;
  const playbackRate = 0.98 + unit(random.rate) * 0.04;
  const wallDurationSeconds = mediaDurationSeconds / playbackRate;
  const fadeInSeconds = Math.min(0.003, wallDurationSeconds * 0.1);
  const fadeOutSeconds = Math.min(0.02, wallDurationSeconds * 0.15);
  const side = history.nextSide;
  return { play: true, plan: { sampleId: sample.id, offsetSeconds, mediaDurationSeconds, playbackRate,
    wallDurationSeconds, peakGain: 0.35 * (0.94 + unit(random.gain) * 0.12) * (conditions.voicePlaying ? 0.35 : 1),
    fadeInSeconds, fadeOutStartSeconds: wallDurationSeconds - fadeOutSeconds, fadeOutSeconds,
    side, nextHistory: { previousId: sample.id, nextSide: side === "left" ? "right" : "left" } } };
}
