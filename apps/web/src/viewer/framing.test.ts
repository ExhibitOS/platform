// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {visitingFov,visitingBuffer} from './framing';
const frames=[[1440,810],[1920,810],[390,844],[844,390]] as const;
test('display choices preserve narrower authored views and allow the unchanged authored option',()=>{
  expect(visitingFov(30,48,16/9)).toBeCloseTo(30);
  expect(visitingFov(60,undefined,1920/810)).toBe(60);
});
test('landscape, portrait and wide projections keep vertical intent and bounded horizontal framing',()=>{
  for(const [width,height] of frames)for(const preferred of [42,48,54]){
    const vertical=visitingFov(60,preferred,width/height);
    const horizontal=2*Math.atan(Math.tan(vertical*Math.PI/360)*width/height)*180/Math.PI;
    expect(vertical).toBeGreaterThan(0);expect(vertical).toBeLessThanOrEqual(preferred);
    expect(horizontal).toBeLessThanOrEqual(84+1e-8);
  }
});
test('a wide-window user choice still changes the actual projection rather than all choices hitting one cap',()=>{
  const values=[42,48,54].map(v=>visitingFov(60,v,1920/810));
  expect(values[0]).toBeLessThan(values[1]!);expect(values[1]).toBeLessThan(values[2]!);
});
test('fullscreen buffers retain the old desktop and compact pixel ceilings with uniform scaling',()=>{
  for(const [width,height,ratio,ceiling] of [[1440,810,1.5,1088640],[1920,810,1.5,1088640],[390,844,1,123120]] as const){
    const frame=visitingBuffer(width,height,ratio);
    expect(frame.ratio).toBeGreaterThan(0);expect(frame.ratio).toBeLessThanOrEqual(ratio);
    expect(Math.floor(width*frame.ratio)*Math.floor(height*frame.ratio)).toBeLessThanOrEqual(ceiling);
    expect(frame.pixelBudget).toBe(ceiling);
  }
});
