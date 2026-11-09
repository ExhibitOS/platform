// SPDX-License-Identifier: AGPL-3.0-or-later
import {useRef} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ENTRANCE_NAMESPACE,entranceFor} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {entranceRuntime} from './entrance-runtime';
import {EntranceEntryOverlay,useEntranceEntry,entryControlsBlocked,publicEntryTransition} from './entrance-entry';

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

it('blocks settings during loading and restores pointer and accessibility access on error or readiness',()=>{
 expect(entryControlsBlocked('3d',false,false,false)).toBe(true);
 expect(entryControlsBlocked('3d',false,false,true)).toBe(false);
 expect(entryControlsBlocked('3d',true,false,false)).toBe(false);
 expect(entryControlsBlocked('3d',false,true,false)).toBe(false);
 expect(entryControlsBlocked('cover',false,false,false)).toBe(false);
});

it('keeps an implicit catalogue door out of public entry while honoring an authored transition',()=>{
 const exhibition=newDraft().candidate;
 const catalogue={version:1,theme:'catalogue'},defaults=entranceFor({});
 exhibition.extensions={...exhibition.extensions,[ENTRANCE_NAMESPACE]:{...defaults,design:catalogue}};
 expect(entranceRuntime(exhibition).effects.transition).toBe('doors');
 expect(publicEntryTransition(entranceRuntime(exhibition))).toBe('none');
 expect(publicEntryTransition(entranceRuntime(exhibition,false,true))).toBe('none');
 exhibition.extensions[ENTRANCE_NAMESPACE]={...defaults,design:{...catalogue,effects:{transition:'doors'}}};
 expect(publicEntryTransition(entranceRuntime(exhibition))).toBe('doors');
});
