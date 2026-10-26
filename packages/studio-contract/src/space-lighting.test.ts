import {describe,it,expect} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {SPACE_LIGHTING_NAMESPACE as N,spaceLightingFor,setSpaceLighting,validateSpaceLighting} from './space-lighting.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';

describe('exhibition-wide space lighting',()=>{
  it('keeps absence and explicit zero distinct without materializing defaults',()=>{
    const source={extensions:{'example/unknown':{keep:[1,'x']},[TEMPLATE_NAMESPACE]:{modified:false}}} as unknown as Exhibition,before=structuredClone(source);
    expect(validateSpaceLighting(source).valid).toBe(true);expect(spaceLightingFor(source)).toBeUndefined();
    expect(setSpaceLighting(source,null)).toEqual(source);
    const zero=setSpaceLighting(source,{version:1,baselineIntensity:0,reflectionIntensity:0});
    expect(spaceLightingFor(zero)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0});
    expect(zero.extensions?.['example/unknown']).toEqual(source.extensions?.['example/unknown']);
    expect((zero.extensions?.[TEMPLATE_NAMESPACE] as unknown as {modified:boolean}).modified).toBe(true);
    expect(source).toEqual(before);
    const removed=setSpaceLighting(zero,null);expect(Object.hasOwn(removed.extensions!,N)).toBe(false);
    // The existing single history item restores the exact original, including absence/provenance.
    expect(before).toEqual(source);expect(Object.hasOwn(before.extensions!,N)).toBe(false);
  });
  it('rejects malformed owned controls while preserving unrelated extension fields',()=>{
    for(const value of [null,[],{}, {version:2,baselineIntensity:0,reflectionIntensity:0},{version:1,baselineIntensity:-.01,reflectionIntensity:0},{version:1,baselineIntensity:0,reflectionIntensity:1.01},{version:1,baselineIntensity:NaN,reflectionIntensity:0},{version:1,baselineIntensity:'0',reflectionIntensity:0},{version:1,baselineIntensity:0,reflectionIntensity:0,extra:true}])expect(validateSpaceLighting({extensions:{[N]:value}}).valid).toBe(false);
    const source={extensions:{[N]:{version:1,baselineIntensity:1,reflectionIntensity:1},'other/space':{future:true}}} as unknown as Exhibition;
    expect(validateSpaceLighting(source).valid).toBe(true);
    const read=spaceLightingFor(source)!;read.baselineIntensity=0;expect(spaceLightingFor(source)?.baselineIntensity).toBe(1);
    expect(()=>setSpaceLighting(source,{version:1,baselineIntensity:Infinity,reflectionIntensity:0})).toThrow('SPACE_LIGHTING_INVALID');
    expect(setSpaceLighting(source,{version:1,baselineIntensity:1,reflectionIntensity:1})).toEqual(source);
  });
});
