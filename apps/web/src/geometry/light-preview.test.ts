// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {PointLight} from 'three';
import {LIGHT_DETAILS_NAMESPACE,TEMPLATE_NAMESPACE,lightKelvinLinear} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import {onlyLightColorChanged,syncPreviewLightColors} from './light-preview';

it('retains a scene only for an exact single-light color change',()=>{
 const original={id:'d',revisionId:'r',lights:[{id:'a',color:[1,1,1],intensity:1},{id:'b',color:[1,1,1],intensity:1}],placements:[{id:'p'}]} as unknown as Exhibition;
 const changed=structuredClone(original);changed.lights[0]!.color=[1,.5,.25];
 expect(onlyLightColorChanged(original,changed)).toBe(true);
 expect(onlyLightColorChanged(changed,original)).toBe(true);
 const both=structuredClone(changed);both.lights[1]!.color=[.5,1,1];expect(onlyLightColorChanged(original,both)).toBe(false);
 const other=structuredClone(changed);other.lights[0]!.intensity=2;expect(onlyLightColorChanged(original,other)).toBe(false);
 const invalid=structuredClone(changed);invalid.lights[0]!.color=[NaN,1,1];expect(onlyLightColorChanged(original,invalid)).toBe(false);
 expect(onlyLightColorChanged(original,original)).toBe(false);
});

it('accepts only the selected light temperature metadata and template modified flag',()=>{
 const id='11111111-1111-4111-8111-111111111111',roomId='22222222-2222-4222-8222-222222222222';
 const before={id:'d',revisionId:'r',lights:[{id,roomId,type:'point',color:[1,1,1]}],rooms:[{id:roomId,dimensions:{width:5,height:3,depth:5}}],extensions:{[TEMPLATE_NAMESPACE]:{modified:false,license:'CC0-1.0'}}} as unknown as Exhibition;
 const after=structuredClone(before);after.lights[0]!.color=lightKelvinLinear(3000);
 after.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:[{lightId:id,fixture:'none',temperatureKelvin:3000}]} as never;
 (after.extensions![TEMPLATE_NAMESPACE] as unknown as {modified:boolean}).modified=true;
 expect(onlyLightColorChanged(before,after)).toBe(true);
 expect(onlyLightColorChanged(after,before)).toBe(true);
 const sameRgb=structuredClone(before);sameRgb.lights[0]!.color=lightKelvinLinear(3000);
 expect(onlyLightColorChanged(sameRgb,after)).toBe(true);
 expect(onlyLightColorChanged(after,sameRgb)).toBe(true);
 const altered=structuredClone(after);(altered.extensions![LIGHT_DETAILS_NAMESPACE] as unknown as {lights:{range:number}[]}).lights[0]!.range=2;
 expect(onlyLightColorChanged(before,altered)).toBe(false);
});

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
