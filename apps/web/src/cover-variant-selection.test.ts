// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {selectCoverVariant} from './cover-variant-selection';
const primary={width:2400,height:1200,bytes:1000000};
const variants=[{id:'small',width:512,height:256,bytes:20000},{id:'medium',width:1600,height:800,bytes:150000},{id:'large',width:2048,height:1024,bytes:300000}];
it('uses actual box and DPR for contain and cover, selecting only sufficient images',()=>{
 expect(selectCoverVariant(primary,variants,{width:700,height:400,pixelRatio:2,fit:'contain'})?.id).toBe('medium');
 expect(selectCoverVariant(primary,variants,{width:700,height:400,pixelRatio:2,fit:'cover'})?.id).toBe('medium');
 expect(selectCoverVariant(primary,variants,{width:700,height:800,pixelRatio:2,fit:'contain'})?.id).toBe('medium');
 expect(selectCoverVariant(primary,variants,{width:700,height:800,pixelRatio:2,fit:'cover'})).toBeUndefined();
 expect(selectCoverVariant(primary,variants,{width:1200,height:600,pixelRatio:2,fit:'contain'})).toBeUndefined();
});
it('keeps primary for missing, malformed, enlarged, nonproportional or nonreducing candidates',()=>{
 expect(selectCoverVariant(primary,variants,undefined)).toBeUndefined();
 expect(selectCoverVariant(primary,variants,{width:0,height:100,pixelRatio:2,fit:'contain'})).toBeUndefined();
 const box={width:100,height:100,pixelRatio:1,fit:'contain' as const};
 expect(selectCoverVariant(primary,[{id:'bad',width:512,height:512,bytes:1}],box)).toBeUndefined();
 expect(selectCoverVariant(primary,[{id:'bad',width:4800,height:2400,bytes:1}],box)).toBeUndefined();
 expect(selectCoverVariant(primary,[{id:'bad',width:512,height:256,bytes:primary.bytes}],box)).toBeUndefined();
 expect(selectCoverVariant(primary,[{id:'bad',width:1,height:1,bytes:1}],{width:1,height:1,pixelRatio:0.1,fit:'contain'})).toBeUndefined();
 expect(selectCoverVariant(primary,[null] as never,box)).toBeUndefined();
 expect(selectCoverVariant(primary,Array(9).fill(variants[0]),box)).toBeUndefined();
 expect(selectCoverVariant(null as never,variants,box)).toBeUndefined();
});
