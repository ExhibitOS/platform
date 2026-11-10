// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AudioControls,audioUseReady,setAudioUse} from './AudioControls';
import type {AudioState} from './audio';
const state=()=>({enabled:false,muted:true,context:'not-created',volume:0,footstepsEnabled:false,reverbEnabled:false,message:'Original browser failure'} as AudioState);
it('waits for actual enable success before unmuting and keeps volume0 independent',async()=>{
 const value=state();let finish!:()=>void;
 const enable=vi.fn(()=>new Promise<void>(resolve=>{finish=()=>{value.enabled=true;value.context='running';resolve();};})),mute=vi.fn(),audio={enable,mute,snapshot:()=>value};
 const task=setAudioUse(audio,true,()=>true);expect(enable).toHaveBeenCalledOnce();expect(mute).not.toHaveBeenCalled();finish();await task;
 expect(mute).toHaveBeenCalledExactlyOnceWith(false);expect(value.volume).toBe(0);expect(audioUseReady(value)).toBe(true);
});
it('treats resolved enable failures and stale publication completion as unavailable',async()=>{
 const value=state(),mute=vi.fn();await setAudioUse({enable:vi.fn(async()=>{}),mute,snapshot:()=>value},true,()=>true);expect(mute).not.toHaveBeenCalled();
 let current=true;await setAudioUse({enable:vi.fn(async()=>{value.enabled=true;value.context='running';current=false;}),mute,snapshot:()=>value},true,()=>current);expect(mute).not.toHaveBeenCalled();
 expect(value.message).toBe('Original browser failure');
});
it('mutes immediately and does not resume an already permitted context to unmute',async()=>{
 const value={...state(),enabled:true,context:'running'},enable=vi.fn(),mute=vi.fn(),audio={enable,mute,snapshot:()=>value};
 await setAudioUse(audio,false,()=>true);expect(mute).toHaveBeenLastCalledWith(true);expect(enable).not.toHaveBeenCalled();
 await setAudioUse(audio,true,()=>true);expect(mute).toHaveBeenLastCalledWith(false);expect(enable).not.toHaveBeenCalled();
});
it('preserves real failure/transcript text and separates mute from zero volume without debug labels',()=>{
 const value=state(),id='11111111-1111-4111-8111-111111111111';
 const html=renderToStaticMarkup(<AudioControls audio={null} state={value} zones={[{id,roomId:'room',transcript:'Required transcript'} as never]} rooms={[{id:'room',name:'첫 공간'}]}/>);
 expect(html).toContain('role="switch"');expect(html).toContain('aria-checked="false"');expect(html).toContain(value.message);expect(html).toContain('음량이 0');expect(html).toContain('Required transcript');expect(html).toContain('첫 공간 소리 1 재생');expect(html).not.toContain(id);expect(html).not.toContain('concrete');
});

it('shows authored sound intent separately from browser permission with expanded room controls',()=>{
 const html=renderToStaticMarkup(<AudioControls audio={null} state={{...state(),soundOn:true,muted:false,bgmOn:true,bgmAvailable:false}} zones={[]}/>);
 expect(html).toContain('aria-checked="true"');
 expect(html).toContain('브라우저에서 소리 켜기');
 expect(html).toMatch(/<details[^>]+ open=""/);
 expect(html).toContain('배경음 사용');
 expect(html).toContain('이 공간에 지정된 배경음이 없어요.');
});
