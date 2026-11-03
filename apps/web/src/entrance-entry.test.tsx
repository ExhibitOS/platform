// SPDX-License-Identifier: AGPL-3.0-or-later
import {useRef} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {EntranceEntryOverlay,useEntranceEntry} from './entrance-entry';

function Overlay({transition,ready=false}:{transition:'none'|'doors';ready?:boolean}){
 const entry=useEntranceEntry(),status=useRef<HTMLParagraphElement>(null);
 return <EntranceEntryOverlay entry={{...entry,stageReady:ready}} transition={transition} speed={1} statusRef={status} onCancel={()=>{}} onText={()=>{}}/>;
}

it('omits door DOM for a no-effect entry while retaining readable loading and recovery',()=>{
 const html=renderToStaticMarkup(<Overlay transition="none"/>);
 expect(html).not.toContain('class="publication-entry-door"');
 expect(html).toContain('role="status"');expect(html).toContain('입장 취소');expect(html).toContain('텍스트로 관람');
 expect(renderToStaticMarkup(<Overlay transition="none" ready/>)).not.toContain('publication-entry-recovery');
});

it('retains the explicitly requested door markup for existing shared consumers',()=>{
 const html=renderToStaticMarkup(<Overlay transition="doors"/>);
 expect(html).toContain('class="publication-entry-door"');expect(html).toContain('publication-entry-door-left');expect(html).toContain('publication-entry-door-right');
});
