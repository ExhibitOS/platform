// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExitConfirmation} from './ExitConfirmation';

it('requires a destination selection and confirmation, with no link activated by opening',()=>{
 const navigate=vi.fn();
 const html=renderToStaticMarkup(<ExitConfirmation onCancel={()=>{}} navigate={navigate} door={{
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
