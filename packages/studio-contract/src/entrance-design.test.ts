// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {ENTRANCE_THEMES,resolveEntranceDesign,validateEntranceDesign,type ViewerEntranceDesign} from './entrance-design.js';
import {ENTRANCE_NAMESPACE,entranceFor,entryPresentationFor,validateViewerEntrance} from './entrance.js';
it('resolves five distinct compatible stages without filling stored optional fields',()=>{
 for(const t of ENTRANCE_THEMES){const input:ViewerEntranceDesign={version:1,theme:t.id},before=structuredClone(input),a=resolveEntranceDesign(input);expect(validateEntranceDesign(input).valid).toBe(true);expect(a.effects).toMatchObject({cover:t.cover,response:t.response,transition:t.transition});expect(input).toEqual(before);a.image.focus[0]=0;expect(resolveEntranceDesign(input).image.focus).toEqual([.5,.5]);}
 expect(resolveEntranceDesign().theme).toBe('catalogue');
});
it('keeps legacy entrance and all five presentation fields unchanged when design is absent',()=>{
 const entrance={version:1,artist:'Original artist',introduction:'Original text',imageAlt:'',mobilePosition:'center',presentation:{ticketTitle:'Preserved title',ticketDetail:'Preserved detail',ticketAnimation:false,coverUnfold:true,doorEffect:false}},candidate={extensions:{[ENTRANCE_NAMESPACE]:entrance}},before=JSON.stringify(candidate);
 expect(validateViewerEntrance(candidate).valid).toBe(true);expect(entranceFor(candidate)).toEqual(entrance);expect(entryPresentationFor(candidate)).toEqual(entrance.presentation);expect(JSON.stringify(candidate)).toBe(before);expect(entranceFor(candidate)).not.toHaveProperty('design');
});
it('admits optional authored groups while rejecting future versions, keys and incompatible effects without rewriting raw values',()=>{
 const input:ViewerEntranceDesign={version:1,theme:'poster',image:{focus:[.1,.9]},effects:{cover:'none'},ticket:{showTime:false}};expect(validateEntranceDesign(input).valid).toBe(true);expect(resolveEntranceDesign(input)).toMatchObject({image:{fit:'contain',focus:[.1,.9]},effects:{cover:'none',response:'press'},ticket:{showDate:true,showTime:false}});
 for(const invalid of [{...input,version:2},{...input,unknown:true},{...input,effects:{cover:'fold'}},{...input,layout:{unknown:1}},{...input,image:{fit:1n}}]){const before=structuredClone(invalid);expect(validateEntranceDesign(invalid).valid).toBe(false);expect(()=>resolveEntranceDesign(invalid as ViewerEntranceDesign)).toThrow('VIEWER_ENTRANCE_DESIGN_INVALID');expect(invalid).toEqual(before);}
});
it('enforces finite layout/focus limits and equal catalogue halves',()=>{
 for(const design of [{layout:{copyRatio:.71}},{layout:{margin:65}},{layout:{titleScale:.74}},{image:{focus:[NaN,.5]}},{effects:{speed:2.1}},{effects:{strength:-.1}}])expect(validateEntranceDesign({version:1,theme:'poster',...design}).valid).toBe(false);
 expect(validateEntranceDesign({version:1,theme:'catalogue',layout:{copyRatio:.3}}).valid).toBe(false);expect(validateEntranceDesign({version:1,theme:'poster',layout:{copyRatio:.3,margin:64,titleScale:1.5}}).valid).toBe(true);
});
it('bounds locale content and refuses duplicates while preserving authored localization',()=>{
 const translations=[{locale:'ko-KR',title:'전시',shortTitle:'짧은 제목',artist:'작가',introduction:'소개'}];expect(resolveEntranceDesign({version:1,theme:'invitation',translations}).translations).toEqual(translations);
 for(const variants of [[...translations,{locale:'KO-kr'}],[{locale:'bad locale'}],[{locale:'en',shortTitle:'x'.repeat(161)}],Array.from({length:17},(_,i)=>({locale:'en-'+String(i+10)}))])expect(validateEntranceDesign({version:1,theme:'invitation',translations:variants}).valid).toBe(false);
});

it('does not erase resolved defaults with explicitly undefined optional fields and preserves zero or false',()=>{
 const input:ViewerEntranceDesign={version:1,theme:'poster',image:{fit:undefined,focus:undefined},ticket:{showDate:undefined,showTime:false},layout:{copyRatio:undefined,margin:0,titleScale:undefined},effects:{enabled:false,cover:undefined,response:undefined,transition:undefined,strength:0,speed:undefined,mobile:undefined}},before=structuredClone(input),resolved=resolveEntranceDesign(input);
 expect(validateEntranceDesign(input).valid).toBe(true);expect(resolved).toMatchObject({image:{fit:'contain',focus:[.5,.5]},ticket:{showDate:true,showTime:false},layout:{copyRatio:.35,margin:0,titleScale:1.25},effects:{enabled:false,cover:'mask',response:'press',transition:'fade',strength:0,speed:1,mobile:'simple'}});expect(input).toEqual(before);
});
