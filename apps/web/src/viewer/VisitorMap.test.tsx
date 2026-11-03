// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {VisitorMap,type VisitorMapProps} from './VisitorMap';
import {createMapPoseSource} from './map-pose';
import type {VisitorMap as MapModel} from './visitor-map';
const map:MapModel={key:'publication/revision',rooms:[{id:'room',name:'첫 공간',outline:[[-4,-3],[4,-3],[4,3],[-4,3]]}],doors:[],placements:[{id:'placement',roomId:'room',title:'선택할 작품',artworkType:'image',point:[2,-2]}],bounds:{x:-5,z:-4,width:10,depth:8}};
function props():VisitorMapProps{return {map,worldPose:{point:[0,0],direction:[0,-1]},destinations:[],available:false,travel:{status:'idle',message:''},onDetails:vi.fn(),onGo:vi.fn(async()=>false),onCancel:vi.fn()};}
it('renders schematic location and heading with keyboard marker buttons without requesting travel',()=>{
 const value=props(),html=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(html).toContain('data-visitor-panel');expect(html).toContain('aria-label="선택할 작품"');expect(html).toContain('visitor-map-position');
 expect(html).not.toContain('선택한 위치로 이동');expect(value.onGo).not.toHaveBeenCalled();expect(value.onDetails).not.toHaveBeenCalled();
});
it('keeps cancellation and a blocked result accessible independently of map selection',()=>{
 const value=props();value.travel={status:'preparing',message:'관람 위치를 준비하고 있어요.'};
 expect(renderToStaticMarkup(<VisitorMap {...value}/>)).toContain('이동 취소');
 value.travel={status:'blocked',message:'이 위치로 이동할 수 없어요.'};
 expect(renderToStaticMarkup(<VisitorMap {...value}/>)).toContain('role="alert"');
});
it('does not invent thumbnails or destination controls from room and placement metadata',()=>{
 const html=renderToStaticMarkup(<VisitorMap {...props()}/>);
 expect(html).not.toContain('<img');expect(html).toContain('공간·작품 선택');expect(html).not.toContain('선택한 위치로 이동');expect(html).not.toContain('안전한');
});
it('keeps the compact room context fixed while actual position and direction move',()=>{
 const value=props(),crop=(html:string)=>html.match(/class="visitor-map-nearby"><svg viewBox="([^"]+)"/)![1];
 value.worldPose={point:[4,-1],direction:[1,0]};const first=renderToStaticMarkup(<VisitorMap {...value}/>);
 value.worldPose={point:[-2,2],direction:[0,1]};const moved=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(crop(moved)).toBe(crop(first));expect(moved).toContain('cx="-2" cy="2"');expect(moved).not.toContain('rotate(');expect(value.onGo).not.toHaveBeenCalled();
});
it('uses only supplied real thumbnails while retaining named keyboard controls and a compact expansion affordance',()=>{
 const description='Long artwork description belongs in the existing detail view.';
 const value=props();value.onPreviewChange=vi.fn();value.previews={placement:{thumbnail:'blob:verified-coarse',description}};
 const html=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(html).toContain('aria-label="전시 지도"');expect(html).toContain('visitor-map-plus');
 expect(html).toContain('src="blob:verified-coarse"');expect(html).toContain('loading="lazy"');
 expect(html).toContain('aria-label="선택할 작품"');expect(html).toContain('<option value="room/room">첫 공간</option>');expect(html).not.toContain('visitor-map-room-label');
 expect(html).not.toContain(description);expect(html).not.toContain('펼치기');
 expect(value.onGo).not.toHaveBeenCalled();expect(value.onDetails).not.toHaveBeenCalled();
 expect(value.onPreviewChange).not.toHaveBeenCalled();
});
it('renders supplied thumbnails for every available marker before any artwork is selected',()=>{
 const value=props();value.map={...map,placements:[...map.placements,{...map.placements[0]!,id:'second',title:'다른 작품',point:[-2,2]}]};
 value.previews={placement:{thumbnail:'blob:verified-first'},second:{thumbnail:'blob:verified-second'}};
 const html=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(html.match(/<img /g)).toHaveLength(2);expect(html).toContain('src="blob:verified-first"');expect(html).toContain('src="blob:verified-second"');
 expect(html).not.toContain('visitor-map-preview-heading');expect(html).not.toContain('aria-pressed="true"');expect(value.onGo).not.toHaveBeenCalled();
});
it('shows only the actual FOV sector and rotates it with heading while keeping the plan fixed',()=>{
 const value=props();value.worldPose={point:[0,0],direction:[0,-1],horizontalFovDegrees:90};
 const coordinates=(html:string)=>html.match(/class="visitor-map-fov" d="([^"]+)"/)![1]!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
 const northHtml=renderToStaticMarkup(<VisitorMap {...value}/>),north=coordinates(northHtml);
 expect(northHtml).not.toContain('<line');expect(northHtml).not.toContain('rotate(');
 expect(north[2]).toBeLessThan(0);expect(north[9]).toBeGreaterThan(0);expect(north[3]).toBeLessThan(0);expect(north[10]).toBeLessThan(0);
 expect(north[2]!*north[9]!+north[3]!*north[10]!).toBeCloseTo(0);
 value.worldPose={point:[0,0],direction:[1,0],horizontalFovDegrees:60};
 const eastHtml=renderToStaticMarkup(<VisitorMap {...value}/>),east=coordinates(eastHtml);
 expect(east[2]).toBeGreaterThan(0);expect(east[9]).toBeGreaterThan(0);
 const cosine=(east[2]!*east[9]!+east[3]!*east[10]!)/(Math.hypot(east[2]!,east[3]!)*Math.hypot(east[9]!,east[10]!));
 expect(cosine).toBeCloseTo(.5);
});
it('does not invent a viewing angle when the actual camera FOV or direction is unavailable',()=>{
 for(const fov of [undefined,NaN,Infinity,0,180,-10]){
  const html=renderToStaticMarkup(<VisitorMap {...props()} worldPose={{point:[0,0],direction:[0,-1],horizontalFovDegrees:fov}}/>);
  expect(html).not.toContain('visitor-map-fov');expect(html).not.toContain('<line');expect(html).toContain('visitor-map-position');
 }
 expect(renderToStaticMarkup(<VisitorMap {...props()} worldPose={{point:[0,0],direction:[0,0],horizontalFovDegrees:60}}/>)).not.toContain('visitor-map-fov');
});
it('fits every full-plan corner within the desktop circle without following or rotating the camera',()=>{
 const value=props();value.worldPose={point:[4,-1],direction:[0,-1],horizontalFovDegrees:70};
 const overview=(html:string)=>html.match(/class="visitor-map-overview"><svg viewBox="([^"]+)"/)![1]!.split(' ').map(Number);
 const first=overview(renderToStaticMarkup(<VisitorMap {...value}/>)),[x,z,width,depth]=first as [number,number,number,number];
 expect(width).toBe(depth);
 const cx=x+width/2,cz=z+depth/2;
 for(const px of [map.bounds.x,map.bounds.x+map.bounds.width])for(const pz of [map.bounds.z,map.bounds.z+map.bounds.depth])expect(Math.hypot(px-cx,pz-cz)).toBeLessThan(width/2);
 value.worldPose={point:[-2,3],direction:[1,0],horizontalFovDegrees:70};
 expect(overview(renderToStaticMarkup(<VisitorMap {...value}/>))).toEqual(first);
 expect(renderToStaticMarkup(<VisitorMap {...value}/>)).toContain('cx="-2" cy="3"');
});
it('keeps wall anchors at their true points while moving thumbnail buttons inside their own room',()=>{
 const value=props();value.map={...map,placements:[{...map.placements[0]!,point:[4,0],facing:[-1,0]}]};
 const original=structuredClone(value.map),html=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(html).not.toContain('visitor-map-anchor-link');expect(html).toContain('visitor-map-work-direction');expect(html).toContain('cx="4" cy="0"');
 const marker=html.match(/class="visitor-map-marker" style="left:([^%]+)%;top:([^%]+)%/)!
 expect(Number(marker[1])).toBeLessThan(90);expect(html).toContain('value="placement/placement"');
 expect(value.map).toEqual(original);expect(value.onGo).not.toHaveBeenCalled();
});
it('exposes narrow-room artwork in an accessible named group and the existing selector without shrinking map targets',()=>{
 const value=props();value.map={...map,rooms:[{id:'room',name:'좁은 방',outline:[[0,-3],[.3,-3],[.3,3],[0,3]]}],placements:[{...map.placements[0]!,point:[.15,0]}]};
 const html=renderToStaticMarkup(<VisitorMap {...value}/>);
 expect(html).toContain('지도 작품 목록');expect(html).toContain('좁은 방 · 목록 1개');expect(html).toContain('visitor-map-list-target');expect(html).toContain('이 공간에 맞춤');expect(html).not.toContain('visitor-map-scope');expect(html).toContain('value="placement/placement"');
 expect(html).not.toContain('class="visitor-map-marker"');expect(html).toContain('visitor-map-work-anchor');
});

it('accepts only the matching pose owner and keeps static map identities when the camera source clears',()=>{
 const value=props(),source=createMapPoseSource(map.key);value.worldPose=undefined;value.poseSource=source;source.publish([1,1.65,2],0,60);
 const live=renderToStaticMarkup(<VisitorMap {...value}/>);expect(live).toContain('cx="1" cy="2"');expect(live).toContain('visitor-map-fov');
 source.clear();const cleared=renderToStaticMarkup(<VisitorMap {...value}/>);expect(cleared).not.toContain('visitor-map-fov');expect(cleared).toContain('value="placement/placement"');expect(cleared).toContain('visitor-map-work-anchor');
 const wrong=createMapPoseSource('other/revision');wrong.publish([99,1.65,99],1,60);value.poseSource=wrong;expect(renderToStaticMarkup(<VisitorMap {...value}/>)).not.toContain('cx="99"');
});

it('keeps the compact tools with the drawing frame and routes repeated hints to help',()=>{
 const html=renderToStaticMarkup(<VisitorMap {...props()}/>);
 expect(html.indexOf('visitor-map-stage')).toBeLessThan(html.indexOf('visitor-map-tools'));
 expect(html.indexOf('visitor-map-tools')).toBeLessThan(html.indexOf('visitor-map-expanded'));
 expect(html).not.toContain('visitor-map-scope');expect(html).not.toContain('공간을 확대하거나 목록에서 작품을 고르세요.');
 expect(html).toContain('공간·작품 선택');expect(html).toContain('지도 도움말');
});
