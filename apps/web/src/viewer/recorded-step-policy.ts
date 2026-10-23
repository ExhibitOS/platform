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
  const eligible = samples.length >= 2 ? samples.filter(sample => sample.id !== history.previousId) : samples;
  const index = Math.min(eligible.length - 1, Math.floor(unit(random.selection) * eligible.length));
  const sample = eligible[index]!;
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
