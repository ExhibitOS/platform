// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ENTRANCE_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {entranceRuntime,entranceContent} from './entrance-runtime';
import {EntranceCover} from './EntranceCover';
import {EntryTicket} from './EntryTicket';
import type {PublicPublication} from './publication-client';
const fixture=()=>{const doc=newDraft('Original title').candidate;doc.extensions={[ENTRANCE_NAMESPACE]:{version:1,artist:'Artist',introduction:'Original copy',imageAlt:'',mobilePosition:'center'}};return doc;};
it('keeps absent design on legacy catalogue and all old independent effect switches',()=>{
 const doc=fixture(),raw=doc.extensions![ENTRANCE_NAMESPACE] as Record<string,unknown>;raw.presentation={ticketTitle:'Saved',ticketDetail:'Saved detail',ticketAnimation:false,coverUnfold:true,doorEffect:false};
 expect(entranceRuntime(doc)).toMatchObject({authored:false,variant:'tear',effects:{cover:'fold',response:'none',transition:'none',strength:1}});expect(entranceRuntime(doc,false,true).effects.cover).toBe('none');
});
it('resolves authored compatible stages and visitor/mobile overrides without rewriting the document',()=>{
 const doc=fixture(),raw=doc.extensions![ENTRANCE_NAMESPACE] as Record<string,unknown>;raw.design={version:1,theme:'poster'};const before=JSON.stringify(doc);
 expect(entranceRuntime(doc)).toMatchObject({variant:'strip',effects:{cover:'mask',response:'press',transition:'fade'}});
 expect(entranceRuntime(doc,true).effects).toMatchObject({cover:'none',response:'none',transition:'none'});expect(entranceRuntime(doc,false,true).effects).toMatchObject({cover:'fade',transition:'fade'});expect(JSON.stringify(doc)).toBe(before);
});
it('uses bounded locale copy/short titles without changing credits or source content',()=>{
 const doc=fixture(),raw=doc.extensions![ENTRANCE_NAMESPACE] as Record<string,unknown>;raw.design={version:1,theme:'artwork',translations:[{locale:'en-GB',title:'Localized title',shortTitle:'Short',artist:'Local artist'}]};const before=JSON.stringify(doc);
 expect(entranceContent(doc,'en-US')).toMatchObject({title:'Localized title',artist:'Local artist',introduction:'Original copy'});expect(entranceContent(doc,'en-GB',true).title).toBe('Short');expect(entranceContent(doc,'ko').title).toBe('Original title');expect(JSON.stringify(doc)).toBe(before);
});
it.each([['poster','strip'],['artwork','minimal'],['invitation','confirm'],['threshold','threshold']] as const)('registers %s in the real host with exactly one theme-appropriate action', (theme,variant)=>{
 const doc=fixture(),raw=doc.extensions![ENTRANCE_NAMESPACE] as Record<string,unknown>;raw.design={version:1,theme};const publication={publication:{id:doc.id,revisionSha256:'a'.repeat(64),publishedAt:doc.createdAt,status:'published'},exhibition:doc,assets:[]} as PublicPublication;
 const html=renderToStaticMarkup(<EntranceCover publication={publication} showImage={false} ticket={<EntryTicket title={doc.title} active={false} animate={false} unavailable={false} variant={variant} buttonRef={null} onEnter={()=>{}}/>}><a href="#text">텍스트로 관람</a></EntranceCover>);
 expect(html).toContain(`entrance-theme-${theme}`);expect(html.match(/<button\b/g)).toHaveLength(1);expect(html).toContain(`publication-entry-action--${variant}`);expect(html).not.toContain('entrance-cover-spread');
});
it('date/time switches hide only requested local-minute fields and retain a single entry action',()=>{
 const hidden=renderToStaticMarkup(<EntryTicket title="Title" active={false} animate={false} unavailable={false} showDate={false} showTime={false} buttonRef={null} onEnter={()=>{}}/>);expect(hidden).not.toContain('<time');expect(hidden.match(/<button\b/g)).toHaveLength(1);
 const time=renderToStaticMarkup(<EntryTicket title="Title" active={false} animate={false} unavailable={false} variant="minimal" showDate={false} buttonRef={null} onEnter={()=>{}}/>);expect(time).toContain('<time');expect(time).not.toContain('publication-entry-ticket-body');
});
