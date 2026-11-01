// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {PointLight} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {syncPreviewLightColors} from './light-preview';

it('previews only changed light colors in place and restores the committed colors on cancel',()=>{
 const a=new PointLight(),b=new PointLight(),lights=new Map([['a',{light:a}],['b',{light:b}]]);
 const doc={id:'d',revisionId:'r',lights:[{id:'a',color:[1,1,1]},{id:'b',color:[1,1,1]}]} as unknown as Exhibition;
 const candidate={id:'d',revisionId:'r',lights:[{id:'a',color:[1,.5,.25]},{id:'b',color:[.2,.3,.4]}]} as unknown as Exhibition;
 const beforeA=a, beforeB=b;
 expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate},'a')).toBe(true);
 expect(a.color.toArray()).toEqual([1,.5,.25]);expect(b.color.toArray()).toEqual([1,1,1]);expect(lights.get('a')?.light).toBe(beforeA);expect(lights.get('b')?.light).toBe(beforeB);
 expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate},'a')).toBe(false);
 expect(syncPreviewLightColors(lights,doc,null)).toBe(true);expect(a.color.toArray()).toEqual([1,1,1]);expect(doc.lights[0]!.color).toEqual([1,1,1]);
});

it('ignores missing identity and stale document previews',()=>{
 const a=new PointLight(),lights=new Map([['a',{light:a}]]),doc={id:'d',revisionId:'r',lights:[{id:'a',color:[1,1,1]}]} as unknown as Exhibition;
 const candidate={id:'other',revisionId:'r',lights:[{id:'a',color:[1,.5,.25]}]} as unknown as Exhibition;
 expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate},'a')).toBe(false);
 candidate.id='d';expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate})).toBe(false);
 expect(a.color.toArray()).toEqual([1,1,1]);
});

it('restores the original color if a transient color becomes invalid',()=>{
 const a=new PointLight(),lights=new Map([['a',{light:a}]]),doc={id:'d',revisionId:'r',lights:[{id:'a',color:[1,1,1]}]} as unknown as Exhibition;
 const candidate={id:'d',revisionId:'r',lights:[{id:'a',color:[1,.5,.25]}]} as unknown as Exhibition;
 expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate},'a')).toBe(true);
 candidate.lights[0]!.color=[1,Number.NaN,.25];
 expect(syncPreviewLightColors(lights,doc,{type:'replace-architecture',candidate},'a')).toBe(true);expect(a.color.toArray()).toEqual([1,1,1]);
});
