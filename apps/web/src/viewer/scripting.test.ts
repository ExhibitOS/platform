// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {ScriptSession} from './scripting';
import type {ScriptHost,ScriptScene} from './scripting';
import type {SpatialProgram} from '@exhibitos/studio-contract';
const program=(actions:SpatialProgram['rules'][number]['actions']):SpatialProgram=>({version:1,rules:[{id:'start',once:true,trigger:{type:'exhibition_start'},actions}]});
const scope={rooms:new Set(['r']),zones:new Set(['z']),placements:new Set(['p']),lights:new Set(['l']),mediaAssets:new Set(['m'])};
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
function fixture(actions:SpatialProgram['rules'][number]['actions']) {const calls:unknown[]=[];const scene:ScriptScene={setLight:(...args)=>calls.push(['light',...args]),setArtworkVisible:(...args)=>calls.push(['visibility',...args]),reset:()=>calls.push(['reset'])};
 const host:ScriptHost={scene:()=>scene,audioAllowed:()=>false,check:async()=>{},playAudio:async(...args)=>{calls.push(['audio',args[0],args[1]]);},stopAudio:id=>calls.push(['stop',id]),changed:()=>{}};
 return {calls,host,session:new ScriptSession(program(actions),scope,host)};
}
test('actual local scene and text commands apply, denied audio remains absent, stop resets effects',async()=>{
 const {session,calls}=fixture([{type:'set_light',lightId:'l',multiplier:.3,delayMs:0},{type:'set_artwork_visibility',placementId:'p',visible:false,delayMs:0},{type:'play_audio',mediaAssetId:'m',volume:1,delayMs:0},{type:'show_text',text:'Original readable narration',locale:'en',delayMs:0}]);
 await session.start(0,1000);await settle();expect(calls).toContainEqual(['light','l',.3]);expect(calls).toContainEqual(['visibility','p',false]);expect(calls.some(c=>(c as string[])[0]==='audio')).toBe(false);expect(session.snapshot().text).toBe('Original readable narration');session.stop();expect(session.snapshot().enabled).toBe(false);expect(session.snapshot().visibility).toEqual({});expect(calls.at(-1)).toEqual(['reset']);
});
test('stop while actual asynchronous rights check pending prevents late visual effects',async()=>{
 const {session,host,calls}=fixture([{type:'set_light',lightId:'l',multiplier:.1,delayMs:0}]);let finish=()=>{};let checks=0;host.check=async()=>{if(++checks===2)await new Promise<void>(resolve=>{finish=resolve;});};
 await session.start(0,1000);await settle();session.stop();finish();await settle();expect(calls.some(c=>(c as string[])[0]==='light')).toBe(false);expect(session.snapshot().enabled).toBe(false);expect(session.snapshot().pending).toBe(0);
});
test('live publication revocation cancels remaining actions and restores original scene',async()=>{
 const {session,host,calls}=fixture([{type:'set_light',lightId:'l',multiplier:.1,delayMs:10},{type:'show_text',text:'must not show',locale:'en',delayMs:10}]);let allowed=true;host.check=async()=>{if(!allowed)throw Error('REVOKED');};await session.start(0,1000);allowed=false;session.advance(20,1020);await settle();expect(session.snapshot().enabled).toBe(false);expect(session.snapshot().text).toBe('');expect(calls.some(c=>(c as string[])[0]==='light')).toBe(false);
});
test('lighting changes closer than500ms are suppressed to bound authored flashing',async()=>{
 const {session,calls}=fixture([{type:'set_light',lightId:'l',multiplier:.1,delayMs:0},{type:'set_light',lightId:'l',multiplier:1,delayMs:10}]);await session.start(0,1000);await settle();session.advance(10,1010);await settle();expect(calls.filter(c=>(c as string[])[0]==='light')).toEqual([['light','l',.1]]);
});


test('idle active visual effects also restore when periodic rights check is revoked',async()=>{
 const {session,host,calls}=fixture([{type:'set_light',lightId:'l',multiplier:.1,delayMs:0}]);let allowed=true;host.check=async()=>{if(!allowed)throw Error('REVOKED');};await session.start(0,1000);await settle();expect(calls).toContainEqual(['light','l',.1]);allowed=false;session.advance(2000,3000);await settle();expect(session.snapshot().enabled).toBe(false);expect(calls.at(-1)).toEqual(['reset']);
});
