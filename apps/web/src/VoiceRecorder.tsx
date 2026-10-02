// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
interface Recording { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; silent: GainNode; chunks: Float32Array[]; samples: number; timer: ReturnType<typeof setTimeout> }
export function encodeVoiceWav(chunks: readonly Float32Array[], samples: number, rate: number) {
  const data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const raw of chunk) { const n = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0; view.setInt16(offset, Math.round(n < 0 ? n * 32768 : n * 32767), true); offset += 2; }
  return data;
}
export function VoiceRecorder({ disabled, onRecorded }: { disabled: boolean; onRecorded: (file: File) => void }) {
  const active = useRef<Recording | null>(null), setup = useRef<{ stream: MediaStream; context: AudioContext | null } | null>(null), generation = useRef(0), mounted = useRef(true), starting = useRef(false);
  const [recording, setRecording] = useState(false), [pending, setPending] = useState(false), [notice, setNotice] = useState(""), [seconds, setSeconds] = useState(0);
  const callback = useRef(onRecorded); callback.current = onRecorded;
  function finish(keep: boolean) {
    generation.current++; starting.current = false;
    const value = active.current; active.current = null;
    const pendingCapture = setup.current; setup.current = null;
    if (pendingCapture) { pendingCapture.stream.getTracks().forEach(t => t.stop()); if (pendingCapture.context && pendingCapture.context.state !== "closed") void pendingCapture.context.close().catch(() => {}); }
    if (value) { clearTimeout(value.timer); value.node.port.onmessage = null; value.source.disconnect(); value.node.disconnect(); value.silent.disconnect(); value.stream.getTracks().forEach(t => t.stop()); void value.context.close().catch(() => {}); }
    if (mounted.current) { setRecording(false); setPending(false); }
    if (keep && value && value.samples > 0 && mounted.current) {
      callback.current(new File([encodeVoiceWav(value.chunks, value.samples, value.context.sampleRate)], "artist-voice.wav", { type: "audio/wav" }));
      setNotice("녹음을 WAV로 준비했습니다. 권리를 확인한 뒤 업로드하세요.");
    }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; finish(false); }; }, []);
  async function start() {
    if (disabled || active.current || starting.current) return;
    starting.current = true;
    const token = ++generation.current; setPending(true); setNotice(""); setSeconds(0);
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false }, video: false });
      if (!mounted.current || token !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const pendingCapture = { stream, context: null as AudioContext | null };
      setup.current = pendingCapture;
      context = new AudioContext({ sampleRate: 48000 }); pendingCapture.context = context;
      if (context.sampleRate < 8000 || context.sampleRate > 48000) throw Error("sample-rate");
      await context.audioWorklet.addModule("/voice-pcm-worklet.js");
      if (!mounted.current || token !== generation.current) { stream.getTracks().forEach(t => t.stop()); if (context.state !== "closed") await context.close(); return; }
      await context.resume();
      if (!mounted.current || token !== generation.current) { stream.getTracks().forEach(t => t.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, "exhibitos-voice-pcm"), silent = context.createGain();
      silent.gain.value = 0; source.connect(node); node.connect(silent); silent.connect(context.destination);
      const value: Recording = { stream, context, source, node, silent, chunks: [], samples: 0, timer: setTimeout(() => finish(true), 60000) };
      setup.current = null; active.current = value;
      node.port.onmessage = event => {
        if (active.current !== value || !(event.data instanceof Float32Array)) return;
        const remain = Math.floor(value.context.sampleRate * 60) - value.samples, chunk = event.data.slice(0, remain);
        value.chunks.push(chunk); value.samples += chunk.length; setSeconds(Math.floor(value.samples / value.context.sampleRate));
        if (chunk.length >= remain) finish(true);
      };
      starting.current = false; setPending(false); setRecording(true); setNotice("녹음 중입니다. 60초 후 자동으로 마이크를 닫습니다. 지금은 업로드하지 않습니다.");
    } catch {
      stream?.getTracks().forEach(t => t.stop()); if (context && context.state !== "closed") await context.close().catch(() => {});
      if (setup.current?.stream === stream) setup.current = null;
      if (mounted.current && token === generation.current) { starting.current = false; setPending(false); setNotice("마이크 또는 녹음을 시작할 수 없습니다. 권한을 확인하거나 PCM WAV 파일을 선택하세요."); }
    }
  }
  return <section aria-label="작가 음성 녹음">
    <p>녹음 시작을 직접 선택할 때만 마이크 권한을 요청합니다. 녹음은 이 기기에서 WAV로 준비하며 업로드는 별도 선택입니다.</p>
    <button disabled={disabled || recording || pending} onClick={() => void start()}>작가 음성 녹음 시작</button>
    <button disabled={!recording} onClick={() => finish(true)}>녹음 정지·WAV 준비</button>
    <button disabled={!recording && !pending} onClick={() => { finish(false); setNotice("녹음을 취소하고 마이크를 닫았습니다."); }}>녹음 취소</button>
    <p role="status">{notice} {recording && `${seconds}초`}</p>
  </section>;
}
