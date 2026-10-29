// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {visitingFov,visitingBuffer,resizeVisitingBuffer,DESKTOP_VISITING_PIXELS} from './framing';
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
test('compact fullscreen buffers retain the former pixel ceilings with uniform scaling',()=>{
  for(const [width,height,ratio,ceiling] of [[1440,810,1.5,1088640],[1920,810,1.5,1088640],[390,844,1,123120]] as const){
    const frame=visitingBuffer(width,height,ratio,true);
    expect(frame.ratio).toBeGreaterThan(0);expect(frame.ratio).toBeLessThanOrEqual(ratio);
    expect(Math.floor(width*frame.ratio)*Math.floor(height*frame.ratio)).toBeLessThanOrEqual(ceiling);
    expect(frame.pixelBudget).toBe(ceiling);
  }
});
test('desktop Full HD at DPR1 uses native internal resolution without upscaling',()=>{
  expect(visitingBuffer(1920,1080,1)).toEqual({pixelBudget:2073600,ratio:1});
  expect(visitingBuffer(1280,720,1)).toEqual({pixelBudget:921600,ratio:1});
});
test('desktop retina and larger windows retain a stable explicit pixel ceiling and preferred DPR limit',()=>{
  for(const [width,height,preferred] of [[1440,810,1.5],[1920,1080,1.5],[3840,2160,1.5],[844,390,1.5]] as const){
    const result=visitingBuffer(width,height,preferred);
    expect(result.ratio).toBeLessThanOrEqual(preferred);
    expect(Math.floor(width*result.ratio)*Math.floor(height*result.ratio)).toBeLessThanOrEqual(DESKTOP_VISITING_PIXELS);
    expect(visitingBuffer(width,height,preferred)).toEqual(result);
  }
  expect(visitingBuffer(3840,2160,1.5).ratio).toBe(.5);
});


test('orientation and ratio changes never create an oversized intermediate drawing buffer',()=>{
 for(const [oldW,oldH,newW,newH,ratio] of [[512,2048,2048,512,1],[1920,1080,1280,720,1.5],[2048,512,512,2048,1]] as const){
  let w:number=oldW,h:number=oldH;const sizes:number[]=[];
  const canvas={style:{},get width(){return w},set width(n:number){w=n;sizes.push(w*h)},get height(){return h},set height(n:number){h=n;sizes.push(w*h)}};
  const renderer={domElement:canvas as unknown as HTMLCanvasElement,setDrawingBufferSize:(width:number,height:number,pixelRatio:number)=>{canvas.width=Math.floor(width*pixelRatio);canvas.height=Math.floor(height*pixelRatio);}};
  resizeVisitingBuffer(renderer,newW,newH,ratio);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.max(oldW*oldH,Math.floor(newW*ratio)*Math.floor(newH*ratio)));
  expect([canvas.width,canvas.height]).toEqual([Math.floor(newW*ratio),Math.floor(newH*ratio)]);
 }
});
