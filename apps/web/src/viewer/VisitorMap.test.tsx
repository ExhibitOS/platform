// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {VisitorMap,type VisitorMapProps} from './VisitorMap';
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
 expect(html).not.toContain('<img');expect(html).toContain('지도에서 고르기');expect(html).not.toContain('선택한 위치로 이동');expect(html).not.toContain('안전한');
});
