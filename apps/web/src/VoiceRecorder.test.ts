// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "vitest";
import { encodeVoiceWav } from "./VoiceRecorder";
import { validatePcmWav } from "../../api/src/audio";
test("locally recorded original samples encode as the actual server's bounded PCM profile", () => {
  const samples = new Float32Array(4800);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * .1) * .6;
  const bytes = Buffer.from(encodeVoiceWav([samples.slice(0, 128), samples.slice(128)], samples.length, 48000));
  expect(validatePcmWav(bytes)).toEqual({ durationSeconds: .1, channels: 1, sampleRate: 48000 });
  expect(bytes.readInt16LE(46)).toBeGreaterThan(0);
  expect(bytes.readInt16LE(44)).toBe(0);
});
test("recorded clipping and nonfinite input cannot overflow PCM16 or leak a non-PCM sample", () => {
  const bytes = Buffer.from(encodeVoiceWav([new Float32Array([-2, 2, NaN, Infinity])], 4, 8000));
  expect(validatePcmWav(bytes).channels).toBe(1);
  expect([44, 46, 48, 50].map(at => bytes.readInt16LE(at))).toEqual([-32768, 32767, 0, 0]);
});
