/* global AudioWorkletProcessor, registerProcessor */
// SPDX-License-Identifier: AGPL-3.0-or-later
// Original mono capture processor. It emits no microphone audio to speakers.
class VoicePcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length && channels[0].length) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels)
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor("exhibitos-voice-pcm", VoicePcmCapture);
