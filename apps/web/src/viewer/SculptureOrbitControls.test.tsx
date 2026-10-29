// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SculptureOrbitControls,type SculptureOrbitControlsProps} from './SculptureOrbitControls';
const actions={step:vi.fn(),press:vi.fn(),release:vi.fn(),stop:vi.fn()};
function state():SculptureOrbitControlsProps['state']{return {placementId:'placement',yaw:0,reducedMotion:false,available:true,canLeft:true,canRight:true,message:''};}
it('keeps discrete steps available under reduced motion',()=>{
 const value={...state(),reducedMotion:true},html=renderToStaticMarkup(<SculptureOrbitControls state={value} actions={actions}/>);
 expect(html).toContain('한 단계씩 시점을 바꿔 감상해요');expect(html).not.toContain('disabled');expect(html).not.toContain('누르고 있으면');
});
it('disables the refused direction without claiming an unrestricted orbit',()=>{
 const html=renderToStaticMarkup(<SculptureOrbitControls state={{...state(),canLeft:false,message:'이 방향으로는 더 이동할 수 없어요.'}} actions={actions}/>);
 expect(html.match(/disabled/g)).toHaveLength(1);expect(html).toContain('role="status"');expect(html).not.toContain('360');
});
it('does not enter orbit or activate a step while rendering unavailable controls',()=>{
 const html=renderToStaticMarkup(<SculptureOrbitControls state={{...state(),available:false}} actions={actions}/>);
 expect(html.match(/disabled/g)).toHaveLength(2);expect(actions.step).not.toHaveBeenCalled();expect(actions.press).not.toHaveBeenCalled();
});
