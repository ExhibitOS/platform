// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {OrderedViewingChrome} from './OrderedViewingChrome';
import type {ViewingState} from './viewing-session';
const items=[{placementId:'a',title:'첫 작품',roomName:'첫 방'},{placementId:'b',title:'둘째 작품',roomName:'둘째 방'},{placementId:'c',title:'마지막 작품',roomName:'셋째 방'}];
const actions={setStyle:vi.fn(),step:vi.fn(),select:vi.fn(),cancel:vi.fn()};
const render=(state:ViewingState)=>renderToStaticMarkup(<OrderedViewingChrome state={state} items={items} actions={actions} onList={()=>{}} listId="menu"/>);
const button=(html:string,label:string)=>html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]??'';
it('only shows a committed ordered stop and keeps boundary slots disabled',()=>{
 expect(render({style:'free',pendingStyle:'ordered',pendingPlacementId:'a',status:'preparing',message:'준비 중'})).toBe('');
 expect(render({style:'ordered',currentPlacementId:'missing',status:'idle',message:''})).toBe('');
 const first=render({style:'ordered',currentPlacementId:'a',status:'idle',message:''});
 expect(button(first,'이전 작품')).toContain('aria-disabled="true"');expect(button(first,'다음 작품')).not.toContain('aria-disabled="true"');expect(first).toContain('첫 작품');
 const middle=render({style:'ordered',currentPlacementId:'b',status:'idle',message:''});expect(button(middle,'이전 작품')).not.toContain('aria-disabled="true"');expect(button(middle,'다음 작품')).not.toContain('aria-disabled="true"');
 const last=render({style:'ordered',currentPlacementId:'c',status:'idle',message:''});expect(button(last,'다음 작품')).toContain('aria-disabled="true"');expect(button(last,'이전 작품')).not.toContain('aria-disabled="true"');
});
it('keeps the committed title while preparing and exposes cancel; blocked stays actionable',()=>{
 const pending=render({style:'ordered',currentPlacementId:'a',pendingPlacementId:'b',status:'preparing',message:'준비 중'});
 expect(pending).toContain('첫 작품');expect(pending).not.toContain('둘째 작품');expect(button(pending,'이전 작품')).toContain('aria-disabled="true"');expect(button(pending,'다음 작품')).toContain('aria-disabled="true"');expect(pending).toContain('이동 취소');expect(pending).toContain('role="status"');
 const blocked=render({style:'ordered',currentPlacementId:'a',status:'blocked',message:'다른 작품을 선택해요'});expect(blocked).toContain('role="alert"');expect(blocked).toContain('첫 작품');expect(button(blocked,'관람 순서 목록 열기')).toContain('aria-controls="menu"');
});
