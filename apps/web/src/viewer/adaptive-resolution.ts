// SPDX-License-Identifier: AGPL-3.0-or-later
/** Only the render buffer changes. Samples are wall-clock intervals between
 * existing motion frames, not GPU timings or available-memory measurements. */
export class AdaptiveResolution {
  private level = 0;
  private slowMs = 0;
  private fastMs = 0;
  private lastChange = -Infinity;
  private readonly scales = [1, .85, .7, .6] as const;

  get scale() { return this.scales[this.level]!; }
  reset() { this.slowMs = 0; this.fastMs = 0; }

  sample(now: number, intervalMs: number, moving: boolean, interrupted: boolean): boolean {
    // A long tab gap, loading or stationary frame is not motion performance.
    if (!Number.isFinite(now) || !Number.isFinite(intervalMs) || intervalMs <= 0 ||
        intervalMs > 1000 || !moving || interrupted) { this.reset(); return false; }
    // A single slow frame cannot change quality. Capping its contribution keeps
    // a one-off stall from standing in for a sustained interval.
    this.slowMs = intervalMs > 35 ? this.slowMs + Math.min(intervalMs,250) : 0;
    this.fastMs = intervalMs < 20 ? this.fastMs + intervalMs : 0;
    if (now - this.lastChange < 8000) return false;
    const next = this.slowMs >= 3000 ? Math.min(this.level+1,this.scales.length-1)
      : this.fastMs >= 8000 ? Math.max(this.level-1,0) : this.level;
    if (next === this.level) return false;
    this.level=next;this.lastChange=now;this.reset();return true;
  }
}
