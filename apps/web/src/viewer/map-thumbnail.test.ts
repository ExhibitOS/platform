// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createMapThumbnailPreview,createMapThumbnailRoster,imageMapThumbnail,MAP_THUMBNAIL_RESERVE_BYTES,MAP_THUMBNAIL_ROSTER_LIMIT,mapThumbnailRosterReserve} from './map-thumbnail';

it('encodes an admitted GPU-oriented bitmap into one bounded upright DOM thumbnail without owning its source',()=>{
 const image={width:2048,height:1024,close:vi.fn()} as unknown as ImageBitmap;
 const scale=vi.fn(),draw=vi.fn(),encode=vi.fn(()=> 'data:image/png;base64,cGl4ZWxz');
 const canvas={width:0,height:0,getContext:()=>({scale,drawImage:draw}),toDataURL:encode} as unknown as HTMLCanvasElement;
 expect(imageMapThumbnail(image,()=>canvas)).toBe('data:image/png;base64,cGl4ZWxz');
 expect(scale).toHaveBeenCalledWith(1,-1);expect(draw).toHaveBeenCalledWith(image,0,-48,96,48);
 expect(encode).toHaveBeenCalledWith('image/png');expect(canvas.width).toBe(0);expect(canvas.height).toBe(0);expect(image.close).not.toHaveBeenCalled();
 expect(MAP_THUMBNAIL_RESERVE_BYTES).toBeGreaterThan(96*96*4*4+65536*2);
});
it('rejects missing context, oversized output and failed canvas encoding without closing source images',()=>{
 const image={width:1,height:1,close:vi.fn()} as unknown as ImageBitmap;
 for(const output of ['data:,','data:image/png;base64,'+'A'.repeat(65536)]){
  const canvas={width:0,height:0,getContext:()=>({scale:()=>{},drawImage:()=>{}}),toDataURL:()=>output} as unknown as HTMLCanvasElement;
  expect(imageMapThumbnail(image,()=>canvas)).toBeUndefined();expect(canvas.width).toBe(0);
 }
 expect(imageMapThumbnail(image,()=>({getContext:()=>null} as unknown as HTMLCanvasElement))).toBeUndefined();
 expect(image.close).not.toHaveBeenCalled();
});
it('waits for the existing admitted image, encodes once, and releases each preview on selection or rights loss',()=>{
 let requested:string|undefined='a',allowed=true,image:ImageBitmap|undefined;
 const changed=vi.fn(),lookup=vi.fn(()=>image),encode=vi.fn(()=> 'data:image/png;base64,cGl4ZWxz');
 const preview=createMapThumbnailPreview({requested:()=>requested,allowed:()=>allowed,image:lookup,changed,encode});
 preview.refresh();expect(changed).toHaveBeenLastCalledWith(null);expect(encode).not.toHaveBeenCalled();
 image={} as ImageBitmap;preview.refresh();expect(changed).toHaveBeenLastCalledWith({placementId:'a',thumbnail:'data:image/png;base64,cGl4ZWxz'});
 preview.refresh();expect(encode).toHaveBeenCalledTimes(1);
 requested='b';image=undefined;preview.refresh();expect(changed).toHaveBeenLastCalledWith(null);
 image={} as ImageBitmap;preview.refresh();expect(encode).toHaveBeenCalledTimes(2);
 allowed=false;preview.refresh();expect(changed).toHaveBeenLastCalledWith(null);expect(encode).toHaveBeenCalledTimes(2);
 preview.dispose();const count=lookup.mock.calls.length;preview.refresh();expect(lookup).toHaveBeenCalledTimes(count);
});
it('does not hot-retry failed encoding and retries only after the selected identity changes',()=>{
 let requested='a';const encode=vi.fn(()=>undefined),changed=vi.fn();
 const preview=createMapThumbnailPreview({requested:()=>requested,allowed:()=>true,image:()=>({} as ImageBitmap),changed,encode});
 preview.refresh();preview.refresh();expect(encode).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenLastCalledWith(null);
 requested='b';preview.refresh();expect(encode).toHaveBeenCalledTimes(2);preview.dispose();
});
it('builds a bounded preselection roster from admitted images only and clears it on rights loss',()=>{
 let allowed=true,now=0;const available=new Set(['a','b']),changed=vi.fn(),encode=vi.fn(()=> 'data:image/png;base64,cGl4ZWxz');
 const ids=['a','b',...Array.from({length:130},(_,i)=>`other${i}`)];
 const roster=createMapThumbnailRoster({ids,allowed:()=>allowed,image:id=>available.has(id)?{} as ImageBitmap:undefined,changed,encode,now:()=>now});
 roster.refresh();expect(changed).toHaveBeenLastCalledWith([{placementId:'a',thumbnail:'data:image/png;base64,cGl4ZWxz'}]);
 roster.refresh();expect(encode).toHaveBeenCalledTimes(1);now=200;roster.refresh();expect(changed).toHaveBeenLastCalledWith([{placementId:'a',thumbnail:'data:image/png;base64,cGl4ZWxz'},{placementId:'b',thumbnail:'data:image/png;base64,cGl4ZWxz'}]);
 roster.refresh();expect(encode).toHaveBeenCalledTimes(2);
 available.add('other9');now=400;roster.refresh();expect(encode).toHaveBeenCalledTimes(3); // Later placements are not starved by the first eight.
 available.add('other129');now=600;roster.refresh();expect(encode).toHaveBeenCalledTimes(3); // Beyond the Viewer placement cap.
 expect(MAP_THUMBNAIL_ROSTER_LIMIT).toBe(128);expect(mapThumbnailRosterReserve(128)).toBe(6.5*1024*1024);expect(mapThumbnailRosterReserve(6)).toBe(800*1024);
 allowed=false;roster.refresh();expect(changed).toHaveBeenLastCalledWith([]);roster.dispose();
});
