// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {formatLength,formatArtworkDimensions} from './dimensions-display';
test('metres display as bounded cm without binary float noise or trailing zeros',()=>{
 expect(formatLength(.587)).toBe('58.7 cm');expect(formatLength(.44799999999995)).toBe('44.8 cm');expect(formatLength(.5)).toBe('50 cm');
 expect(formatArtworkDimensions({width:.587,height:.44799999999995})).toBe('너비 58.7 cm × 높이 44.8 cm');
});
test('invalid measurements never become zero or an invented size',()=>{
 for(const v of [null,undefined,NaN,Infinity,-Infinity,0,-.1,'0.5'])expect(formatLength(v)).toBe('크기 정보 없음');
 for(const d of [null,{}, {width:0,height:1},{width:.5,height:NaN}])expect(formatArtworkDimensions(d)).toBe('크기 정보 없음');
 expect(formatArtworkDimensions({width:.5,height:1},{includeDepth:true})).toBe('너비 50 cm × 높이 100 cm × 깊이 크기 정보 없음');
});
test('small positive values retain a smaller unit or an honest nonzero bound',()=>{
 expect(formatLength(.0005)).toBe('0.5 mm');expect(formatLength(.000001)).toBe('0.1 mm 미만');
 expect(formatLength(.0005,{unit:'m'})).toBe('0.1 m 미만');expect(formatLength(Number.MIN_VALUE)).toBe('0.1 mm 미만');
});
test('explicit display preference and known coarser precision are honored without edits',()=>{
 expect(formatLength(.587,{unit:'mm'})).toBe('587 mm');expect(formatLength(.587,{unit:'m'})).toBe('0.6 m');expect(formatLength(.587,{precisionMeters:.01})).toBe('59 cm');
 const source={width:.587,height:.44799999999995,depth:.2},before=structuredClone(source);expect(formatArtworkDimensions(source,{includeDepth:true})).toContain('깊이 20 cm');expect(source).toEqual(before);
});
