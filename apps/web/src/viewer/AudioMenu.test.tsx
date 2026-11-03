// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AudioMenu,audioMenuStatus} from './AudioMenu';
import type {AudioState,ExhibitionAudio} from './audio';
it('describes actual sound availability without claiming playback or toggling mute on panel access',()=>{
 const state={enabled:true,muted:false,volume:.5,suspended:false,context:'running'} as AudioState;
 expect(audioMenuStatus(null).icon).toBe('silent');expect(audioMenuStatus(state).label).toBe('소리 켜짐');
 expect(audioMenuStatus({...state,muted:true}).label).toBe('소리 꺼짐');expect(audioMenuStatus({...state,volume:0})).toEqual({label:'음량 0',icon:'silent'});
 expect(audioMenuStatus({...state,suspended:true}).icon).toBe('paused');expect(audioMenuStatus({...state,context:'suspended'}).icon).toBe('paused');
 const mute=vi.fn(),enable=vi.fn(),html=renderToStaticMarkup(<AudioMenu immersive audio={{mute,enable} as unknown as ExhibitionAudio} state={state} zones={[]}/>);
 expect(html).toContain('aria-label="소리 설정 · 소리 켜짐"');expect(html).toContain('aria-expanded="false"');expect(html).toContain('aria-controls=');expect(html).toContain('data-visitor-panel');
 expect(mute).not.toHaveBeenCalled();expect(enable).not.toHaveBeenCalled();
});
