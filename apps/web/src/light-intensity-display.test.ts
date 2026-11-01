// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {formatLightIntensity,lightIntensityInputText,lightIntensityValueText,lightIntensityUnit} from './light-intensity-display';

it.each([
 [0,'0'],[-0,'0'],[100,'100'],[1234.123456789,'1234'],[123.123456789,'123.1'],[12.123456789,'12.12'],[1.123456789,'1.123'],[.123456789,'0.1235'],[.000123456789,'0.0001235'],[.00000123456789,'0.000001235'],[.000000123456789,'1.235e-7'],[1234567890,'1.235e+9'],
])('formats %s as concise presentation %s', (value,text)=>{expect(formatLightIntensity(value)).toBe(text);});

it('never displays a finite positive extreme as zero or infinity',()=>{
 for(const value of [Number.MIN_VALUE,1e-300,1e-15,1e-7,1e9,1e20,1e300,Number.MAX_VALUE]){
  const text=formatLightIntensity(value);expect(Number(text)).toBeGreaterThan(0);expect(Number.isFinite(Number(text))).toBe(true);expect(text.length).toBeLessThanOrEqual(24);
 }
});

it('focus and blur change presentation only, so untouched apply retains exact numeric bits',()=>{
 for(const [raw,shownSpoken,editingSpoken] of [
  ['123.123456789012','123.1','123.123456789012'],
  ['0.000000123456789','1.235 곱하기 10의 마이너스 7제곱','0.000000123456789'],
  ['003.12500','3.125','003.12500'],
  ['1.234567890123e20','1.235 곱하기 10의 20제곱','1.234567890123 곱하기 10의 20제곱'],
  ['-0','0','-0'],
 ]){
  const bits=Number(raw),shown=lightIntensityInputText(raw),focused=lightIntensityInputText(raw,true),blurred=lightIntensityInputText(raw,false);
  expect(focused).toBe(raw);expect(blurred).toBe(shown);expect(Object.is(Number(raw),bits)).toBe(true);
  expect(lightIntensityValueText(raw,'candela')).toBe(`${shownSpoken} 칸델라`);expect(lightIntensityValueText(raw,'candela',true)).toBe(`${editingSpoken} 칸델라`);
 }
});

it('retains direct editing text and invalid or empty drafts instead of coercing them',()=>{
 for(const raw of ['',' ','NaN','Infinity','-1','1.','0.000000123456789012','1e-'])expect(lightIntensityInputText(raw,true)).toBe(raw);
 for(const raw of ['',' ','NaN','Infinity','-1','1e-']){
  expect(lightIntensityInputText(raw)).toBe(raw);expect(lightIntensityValueText(raw,'lumen')).toBe('입력한 밝기를 확인하세요.');
 }
});

it('keeps each declared unit and unsupported-unit fallback independent of number formatting',()=>{
 for(const [unit,symbol,name] of [['candela','cd','칸델라'],['lumen','lm','루멘'],['lux','lx','럭스']]){
  expect(lightIntensityUnit(unit).symbol).toBe(symbol);expect(lightIntensityValueText('123.123456789',unit)).toBe(`123.1 ${name}`);
 }
 expect(lightIntensityUnit('watt').symbol).toBe('watt');expect(lightIntensityUnit('watt').description).toBe('지원하지 않는 단위: watt');expect(lightIntensityUnit(undefined).name).toBe('단위 정보 없음');
});
