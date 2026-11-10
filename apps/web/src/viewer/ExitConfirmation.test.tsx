// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExitConfirmation,confirmExitDestination} from './ExitConfirmation';

it('requires a destination selection and confirmation, with no link activated by opening',()=>{
 const navigate=vi.fn();
 const html=renderToStaticMarkup(<ExitConfirmation canNavigate={()=>true} onCancel={()=>{}} navigate={navigate} door={{
  placementId:'door',surfaceId:'wall',primary:{name:'ExhibitOS',url:'https://exhibitos.org/'},
  additional:[{name:'자료실',url:'https://archive.example/'},{name:'Invalid',url:'http://invalid.example'}],
 }}/>);
 expect(html).toContain('선택한 외부 웹사이트로 이동합니다.');
 expect(html).toContain('ExhibitOS');
 expect(html).toContain('자료실');
 expect(html).toContain('계속 관람');
 expect(html).toMatch(/<button[^>]+disabled="">전시 나가기<\/button>/);
 expect(html).not.toContain('Invalid');
 expect(html).not.toContain('href=');
 expect(navigate).not.toHaveBeenCalled();
});

it('rechecks the barrier before navigation after a dialog has been opened',()=>{
 const navigate=vi.fn(),url='https://exhibitos.org/';
 let mounted=true;
 const canNavigate=()=>mounted;
 expect(canNavigate()).toBe(true);
 mounted=false;
 expect(confirmExitDestination(url,canNavigate,navigate)).toBe(false);
 expect(navigate).not.toHaveBeenCalled();
 mounted=true;
 expect(confirmExitDestination(url,canNavigate,navigate)).toBe(true);
 expect(navigate).toHaveBeenCalledExactlyOnceWith(url);
});
