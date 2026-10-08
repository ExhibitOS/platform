// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import type { Exhibition, JsonValue } from '@exhibitos/spec';
import { SpatialEvaluator, SPATIAL_NAMESPACE, spatialProgramFor, spatialScopeFor, validateSpatialProgram, type SpatialEvent, type SpatialAction, type SpatialProgram, type SpatialScope, type SpatialPumpResult } from '@exhibitos/studio-contract';
import { validateDraft } from './drafts/validator';

type Rule = SpatialProgram['rules'][number];
const events: SpatialEvent['type'][] = ['room_enter', 'room_leave', 'zone_enter', 'zone_leave', 'artwork_approach', 'artwork_look', 'artwork_click', 'exhibition_start', 'exhibition_end', 'elapsed_time', 'absolute_time', 'custom_event'];
const actions: SpatialAction['type'][] = ['set_light', 'play_audio', 'stop_audio', 'show_text', 'set_artwork_visibility', 'emit_event'];
const first = (set: ReadonlySet<string>) => [...set][0] ?? '';
function eventFor(type: SpatialEvent['type'], scope: SpatialScope): SpatialEvent {
  switch (type) {
    case 'room_enter': case 'room_leave': return { type, roomId: first(scope.rooms) };
    case 'zone_enter': case 'zone_leave': return { type, zoneId: first(scope.zones) };
    case 'artwork_approach': case 'artwork_look': case 'artwork_click': return { type, placementId: first(scope.placements) };
    case 'elapsed_time': return { type, atMs: 0 };
    case 'absolute_time': return { type, atUtc: '2026-10-02T00:00:00.000Z' };
    case 'custom_event': return { type, name: 'visitor.choice' };
    default: return { type };
  }
}
function actionFor(type: SpatialAction['type'], scope: SpatialScope, delayMs = 0): SpatialAction {
  switch (type) {
    case 'set_light': return { type, lightId: first(scope.lights), multiplier: 1, delayMs };
    case 'play_audio': return { type, mediaAssetId: first(scope.mediaAssets), volume: 1, delayMs };
    case 'stop_audio': return { type, mediaAssetId: first(scope.mediaAssets), delayMs };
    case 'set_artwork_visibility': return { type, placementId: first(scope.placements), visible: true, delayMs };
    case 'emit_event': return { type, name: 'visitor.choice', delayMs };
    case 'show_text': return { type, text: '전시 안내', locale: 'ko', delayMs };
  }
}
function Target({ label, value, values, disabled, onChange }: { label: string; value: string; values: ReadonlySet<string>; disabled: boolean; onChange: (value: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {!values.has(value) && <option value={value}>{value || '대상 없음'} — 유효한 대상을 선택하세요</option>}
    {[...values].map(id => <option key={id} value={id}>{id}</option>)}
  </select></label>;
}
function EventFields({ value, scope, disabled, prefix, onChange }: { value: SpatialEvent; scope: SpatialScope; disabled: boolean; prefix: string; onChange: (event: SpatialEvent) => void }) {
  return <>
    <label>{prefix} 이벤트<select aria-label={`${prefix} 이벤트`} value={value.type} disabled={disabled} onChange={e => onChange(eventFor(e.target.value as SpatialEvent['type'], scope))}>{events.map(type => <option key={type}>{type}</option>)}</select></label>
    {'roomId' in value && <Target label={`${prefix} 대상`} value={value.roomId} values={scope.rooms} disabled={disabled} onChange={roomId => onChange({ ...value, roomId })} />}
    {'zoneId' in value && <Target label={`${prefix} 대상`} value={value.zoneId} values={scope.zones} disabled={disabled} onChange={zoneId => onChange({ ...value, zoneId })} />}
    {'placementId' in value && <Target label={`${prefix} 대상`} value={value.placementId} values={scope.placements} disabled={disabled} onChange={placementId => onChange({ ...value, placementId })} />}
    {'atMs' in value && <label>{prefix} 경과 밀리초<input aria-label={`${prefix} 경과 밀리초`} type="number" min="0" max="3600000" step="1" value={value.atMs} disabled={disabled} onChange={e => onChange({ ...value, atMs: e.target.valueAsNumber })} /></label>}
    {'atUtc' in value && <label>{prefix} UTC 시각<input aria-label={`${prefix} UTC 시각`} value={value.atUtc} placeholder="2026-10-02T00:00:00.000Z" disabled={disabled} onChange={e => onChange({ ...value, atUtc: e.target.value })} /></label>}
    {'name' in value && <label>{prefix} 사용자 이벤트 이름<input aria-label={`${prefix} 사용자 이벤트 이름`} value={value.name} maxLength={64} disabled={disabled} onChange={e => onChange({ ...value, name: e.target.value })} /></label>}
  </>;
}
/** Declarative authoring only. Parent owns draft persistence/CAS and publication. */
export function ScriptingEditor({ candidate, disabled, onChange }: { candidate: Exhibition; disabled: boolean; onChange: (next: Exhibition) => void }) {
  const latest = useRef({ candidate, disabled }); latest.current = { candidate, disabled };
  const scope = spatialScopeFor(candidate);
  const program = spatialProgramFor(candidate) ?? { version: 1 as const, rules: [] };
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<Rule | null>(null);
  const [base, setBase] = useState('');
  const [notice, setNotice] = useState('');
  const [newAction, setNewAction] = useState<SpatialAction['type']>('show_text');
  const evaluator = useRef<SpatialEvaluator | null>(null);
  const simulationSource = useRef('');
  const capability = useRef(true);
  const [allow, setAllow] = useState(true);
  const [simulationEvent, setSimulationEvent] = useState<SpatialEvent>({ type: 'exhibition_start' });
  const [elapsed, setElapsed] = useState(0), [wall, setWall] = useState('2026-10-02T00:00:00.000Z');
  const [result, setResult] = useState<SpatialPumpResult | null>(null);
  useEffect(() => () => { evaluator.current?.unload(); }, []);
  useEffect(() => { if (disabled) evaluator.current?.cancel(); }, [disabled]);
  function load(id: string) {
    const source = spatialProgramFor(latest.current.candidate) ?? { version: 1 as const, rules: [] };
    const rule = source.rules.find(r => r.id === id);
    setSelected(id); setDraft(rule ? structuredClone(rule) : null); setBase(JSON.stringify(source)); setNotice('');
  }
  function publish(next: SpatialProgram): boolean {
    const current = latest.current;
    if (current.disabled) return false;
    const validation = validateSpatialProgram(next, spatialScopeFor(current.candidate));
    if (!validation.valid || new TextEncoder().encode(JSON.stringify(next)).length > 16384) {
      setNotice('참조·규칙·동작·UTC·정수 한도 또는16KiB를 확인하세요. 원본 문서와 입력을 유지했습니다.'); return false;
    }
    const doc = structuredClone(current.candidate);
    doc.extensions = { ...doc.extensions, [SPATIAL_NAMESPACE]: next as unknown as { [key: string]: JsonValue } };
    const envelope = { schemaVersion: '1.0.0-draft.1', kind: 'exhibition-draft', id: doc.id, exhibitionId: doc.id, editVersion: 1, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', candidate: doc };
    if (!validateDraft(envelope).valid) { setNotice('전시 문서 검증이 실패했습니다. 원본과 입력을 유지했습니다.'); return false; }
    evaluator.current?.cancel(); evaluator.current = null; setResult(null);
    // Synchronous optimistic guard handles repeated gestures before parent re-render.
    latest.current = { ...current, candidate: doc };
    onChange(doc); setBase(JSON.stringify(next)); setNotice('현재 전시 입력에 적용했습니다. 기존 로컬·서버 저장을 실행한 뒤 공개하세요.'); return true;
  }
  function apply() {
    if (!draft || latest.current.disabled) return;
    const source = spatialProgramFor(latest.current.candidate) ?? { version: 1 as const, rules: [] };
    if (base !== JSON.stringify(source)) { setNotice('저장된 규칙이 변경되었습니다. 입력을 유지합니다. 규칙 다시 불러오기를 먼저 실행하세요.'); return; }
    const rules = source.rules.map(r => r.id === selected ? structuredClone(draft) : r);
    if (!source.rules.some(r => r.id === selected)) { setNotice('선택한 규칙이 없어졌습니다. 다시 불러오세요.'); return; }
    if (publish({ version: 1, rules })) setSelected(draft.id);
  }
  function add() {
    if (latest.current.disabled) return;
    const source = spatialProgramFor(latest.current.candidate) ?? { version: 1 as const, rules: [] };
    const rule: Rule = { id: 'rule-' + crypto.randomUUID(), trigger: { type: 'exhibition_start' }, actions: [actionFor('show_text', spatialScopeFor(latest.current.candidate))], once: false };
    const next: SpatialProgram = { version: 1, rules: [...source.rules, rule] };
    if (publish(next)) { setSelected(rule.id); setDraft(structuredClone(rule)); }
  }
  function remove() {
    if (latest.current.disabled) return;
    const source = spatialProgramFor(latest.current.candidate) ?? { version: 1 as const, rules: [] };
    if (base !== JSON.stringify(source)) { setNotice('규칙이 변경되었습니다. 다시 불러오세요.'); return; }
    if (publish({ version: 1, rules: source.rules.filter(r => r.id !== selected) })) { setSelected(''); setDraft(null); }
  }
  function editAction(index: number, value: SpatialAction) { setDraft(d => d ? { ...d, actions: d.actions.map((a, i) => i === index ? value : a) } : d); }
  function move(index: number, delta: number) { setDraft(d => { if (!d) return d; const next = [...d.actions], other = index + delta; if (other < 0 || other >= next.length) return d; [next[index], next[other]] = [next[other]!, next[index]!]; return { ...d, actions: next }; }); }
  function simulate(advance: boolean) {
    if (latest.current.disabled) return;
    const current = latest.current.candidate, source = spatialProgramFor(current) ?? { version: 1 as const, rules: [] };
    const signature = JSON.stringify({ program: source, scope: Object.entries(spatialScopeFor(current)).map(([key, ids]) => [key, [...ids]]) });
    if (evaluator.current && simulationSource.current !== signature) { evaluator.current.cancel(); evaluator.current = null; setNotice('규칙 또는 대상이 변경되어 시뮬레이션을 초기화했습니다.'); }
    try {
      if (!evaluator.current) { evaluator.current = new SpatialEvaluator(source, spatialScopeFor(current), () => capability.current); simulationSource.current = signature; }
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(wall) || !Number.isFinite(Date.parse(wall)) || new Date(wall).toISOString() !== wall) { setNotice('정규 UTC 시각을 입력하세요.'); return; }
      const clock = { elapsedMs: elapsed, wallUtcMs: Date.parse(wall) };
      setResult(advance ? evaluator.current.advance(clock) : evaluator.current.dispatch(simulationEvent, clock));
    } catch { setNotice('유효한 규칙·대상·시계로 시뮬레이션을 실행하세요. 원본은 유지됩니다.'); }
  }
  return <section aria-label="Spatial Scripting 편집기">
    <h3>Spatial Scripting — WHEN / THEN / AFTER</h3>
    <p>방문자별 선언 규칙입니다. 코드·URL·외부 실행 입력은 없습니다. AFTER는 앞 동작 이후의 정수 밀리초입니다. 원본 OES scripts는 변경하지 않습니다.</p>
    <label>스크립트 규칙 선택<select aria-label="스크립트 규칙 선택" value={selected} disabled={disabled} onChange={e => load(e.target.value)}><option value="">규칙 선택</option>{program.rules.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label>
    <button type="button" disabled={disabled || program.rules.length >= 32} onClick={add}>규칙 추가</button>
    <button type="button" disabled={disabled || !selected} onClick={() => load(selected)}>규칙 다시 불러오기</button>
    {draft && <fieldset disabled={disabled}><legend>선택 규칙 편집 — 적용 전 입력</legend>
      <label>규칙 ID<input aria-label="규칙 ID" value={draft.id} maxLength={64} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
      <EventFields prefix="WHEN" value={draft.trigger} scope={scope} disabled={disabled} onChange={trigger => setDraft({ ...draft, trigger })} />
      <label><input aria-label="한 번만 실행" type="checkbox" checked={draft.once} onChange={e => setDraft({ ...draft, once: e.target.checked })} />한 번만 실행</label>
      {draft.actions.map((action, index) => { const n = index + 1; return <fieldset key={index}><legend>THEN {n}</legend>
        <label>THEN 동작 {n}<select aria-label={`THEN 동작 ${n}`} value={action.type} onChange={e => editAction(index, actionFor(e.target.value as SpatialAction['type'], scope, action.delayMs))}>{actions.map(type => <option key={type}>{type}</option>)}</select></label>
        {'lightId' in action && <Target label={`THEN 대상 ${n}`} value={action.lightId} values={scope.lights} disabled={disabled} onChange={lightId => editAction(index, { ...action, lightId })} />}
        {'mediaAssetId' in action && <Target label={`THEN 대상 ${n}`} value={action.mediaAssetId} values={scope.mediaAssets} disabled={disabled} onChange={mediaAssetId => editAction(index, { ...action, mediaAssetId })} />}
        {'placementId' in action && <Target label={`THEN 대상 ${n}`} value={action.placementId} values={scope.placements} disabled={disabled} onChange={placementId => editAction(index, { ...action, placementId })} />}
        {'multiplier' in action && <label>조명 배율 {n}<input aria-label={`조명 배율 ${n}`} type="number" min="0" max="1" step="0.01" value={action.multiplier} onChange={e => editAction(index, { ...action, multiplier: e.target.valueAsNumber })} /></label>}
        {'volume' in action && <label>오디오 볼륨 {n}<input aria-label={`오디오 볼륨 ${n}`} type="number" min="0" max="1" step="0.01" value={action.volume} onChange={e => editAction(index, { ...action, volume: e.target.valueAsNumber })} /></label>}
        {'text' in action && <><label>안내 텍스트 {n}<textarea aria-label={`안내 텍스트 ${n}`} maxLength={4096} value={action.text} onChange={e => editAction(index, { ...action, text: e.target.value })} /></label><label>텍스트 언어 {n}<input aria-label={`텍스트 언어 ${n}`} value={action.locale} onChange={e => editAction(index, { ...action, locale: e.target.value })} /></label></>}
        {'name' in action && <label>발행 이벤트 이름 {n}<input aria-label={`발행 이벤트 이름 ${n}`} value={action.name} maxLength={64} onChange={e => editAction(index, { ...action, name: e.target.value })} /></label>}
        {'visible' in action && <label><input aria-label={`작품 표시 ${n}`} type="checkbox" checked={action.visible} onChange={e => editAction(index, { ...action, visible: e.target.checked })} />작품 표시 {n}</label>}
        <label>AFTER 밀리초 {n}<input aria-label={`AFTER 밀리초 ${n}`} type="number" min="0" max="3600000" step="1" value={action.delayMs} onChange={e => editAction(index, { ...action, delayMs: e.target.valueAsNumber })} /></label>
        <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>동작 위로 {n}</button><button type="button" disabled={index === draft.actions.length - 1} onClick={() => move(index, 1)}>동작 아래로 {n}</button><button type="button" disabled={draft.actions.length === 1} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })}>동작 삭제 {n}</button>
      </fieldset>; })}
      <label>추가할 동작<select aria-label="추가할 동작" value={newAction} onChange={e => setNewAction(e.target.value as SpatialAction['type'])}>{actions.map(type => <option key={type}>{type}</option>)}</select></label>
      <button type="button" disabled={draft.actions.length >= 16} onClick={() => setDraft({ ...draft, actions: [...draft.actions, actionFor(newAction, scope)] })}>동작 추가</button>
      <button type="button" onClick={apply}>규칙 적용</button><button type="button" onClick={remove}>규칙 삭제</button>
    </fieldset>}
    <p role="status">{notice}</p>
    <fieldset disabled={disabled}><legend>SIMULATION — 현재 적용된 규칙만 실행</legend>
      <p>모의 capability 허용/거부를 사용합니다. 실제 권리·동의 검증이나 장면·조명·음성·서버 실행을 증명하지 않습니다. 편집 중인 미적용 입력은 실행하지 않습니다. 시간 이벤트는 이벤트 전달 대신 시계 진행으로 검사하세요. 시계는 이전 값 이상이어야 합니다.</p>
      <EventFields prefix="시뮬레이션" value={simulationEvent} scope={scope} disabled={disabled} onChange={setSimulationEvent} />
      <label>시뮬레이션 경과 밀리초<input aria-label="시뮬레이션 시계 경과 밀리초" type="number" min="0" step="1" value={elapsed} onChange={e => setElapsed(e.target.valueAsNumber)} /></label>
      <label>시뮬레이션 UTC 시각<input aria-label="시뮬레이션 시계 UTC 시각" value={wall} onChange={e => setWall(e.target.value)} /></label>
      <label><input aria-label="시뮬레이션 권한 허용" type="checkbox" checked={allow} onChange={e => { capability.current = e.target.checked; setAllow(e.target.checked); }} />시뮬레이션 권한 허용</label>
      <button type="button" onClick={() => simulate(false)}>시뮬레이션 이벤트 전달</button><button type="button" onClick={() => simulate(true)}>시뮬레이션 시계 진행</button>
      <button type="button" onClick={() => { if (!latest.current.disabled) setResult(evaluator.current?.cancel() ?? null); }}>시뮬레이션 취소</button>
      <button type="button" onClick={() => { if (latest.current.disabled) return; evaluator.current?.cancel(); evaluator.current = null; setResult(null); setElapsed(0); }}>시뮬레이션 초기화</button>
      {result && <><h4>시뮬레이션 명령 / trace</h4><pre data-testid="spatial-simulation">{JSON.stringify({ ...result, state: evaluator.current?.snapshot() }, null, 2)}</pre></>}
    </fieldset>
  </section>;
}
