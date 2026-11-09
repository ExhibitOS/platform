// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {containedImageSize,flatImageView,imageFit,zoomImage,FlatImageGesture} from './flat-image-view';
const v={width:800,height:600,imageWidth:2400,imageHeight:1200,pixelRatio:1};
test('contains full image without distortion and caps zoom at admitted source pixels',()=>{
 expect(imageFit(v)).toEqual({width:800,height:400,maxZoom:3});
 expect(imageFit({...v,pixelRatio:2}).maxZoom).toBe(1.5);
 expect(flatImageView({yaw:90,pitch:80,zoom:99,panX:9999,panY:-9999},v)).toEqual({yaw:0,pitch:0,zoom:3,panX:800,panY:-300});
 expect(flatImageView({yaw:0,pitch:0,zoom:1,panX:20,panY:30},v)).toEqual({yaw:0,pitch:0,zoom:1,panX:0,panY:0});
});
test('zoom keeps the pointed image location stationary then clamps at fit',()=>{
 const view=zoomImage({yaw:0,pitch:0,zoom:1},2,100,0,v);expect(view.panX).toBe(-100);
 expect(zoomImage(view,1,100,0,v)).toEqual({yaw:0,pitch:0,zoom:1,panX:0,panY:0});
});
test('pinch and one-pointer transitions pan the image without rotation or a jump',()=>{
 const gesture=new FlatImageGesture();gesture.begin(1,{x:-100,y:0});gesture.begin(2,{x:100,y:0});
 const pinched=gesture.move(2,{x:200,y:0},{yaw:0,pitch:0,zoom:2},v);expect(pinched.zoom).toBe(3);expect(pinched.yaw).toBe(0);expect(pinched.pitch).toBe(0);
 gesture.end(2);const panned=gesture.move(1,{x:-90,y:0},pinched,v);expect(panned.panX).toBe((pinched.panX??0)+10);
 gesture.clear();expect(gesture.move(1,{x:999,y:999},panned,v)).toEqual(panned);
});

test('contains both authored Aristotle tiers in the same physical footprint',()=>{
 const footprint={width:1.365,height:1.435};
 for(const [imageWidth,imageHeight] of [[1942,2048],[486,512],[400,200]] as const){
  const face=containedImageSize({...footprint,imageWidth,imageHeight});
  expect(face.width/face.height).toBeCloseTo(imageWidth/imageHeight,12);
  expect(face.width).toBeLessThanOrEqual(footprint.width);
  expect(face.height).toBeLessThanOrEqual(footprint.height);
 }
});
