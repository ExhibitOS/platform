// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {ARTWORK_THUMBNAIL_NAMESPACE as NS,artworkThumbnailFor,validateArtworkThumbnail,checkArtworkThumbnailPng,checkedArtworkThumbnailView} from './artwork-thumbnail.js';
const primary='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000002';
const asset={id,role:'preview',mime:'image/png',path:'preview.png',bytes:128,sha256:'a'.repeat(64)};
const artwork=()=>({primaryAssetId:primary,assets:[{...asset}],extensions:{[NS]:{version:1,assetId:id}}});
it('selects only the explicit bounded preview in this artwork inventory',()=>{
 expect(artworkThumbnailFor(artwork())).toEqual(asset);
 for(const change of [
  (a:ReturnType<typeof artwork>)=>{a.extensions[NS].assetId=primary;},
  (a:ReturnType<typeof artwork>)=>{a.assets[0]!.role='image';},
  (a:ReturnType<typeof artwork>)=>{a.assets[0]!.bytes=512*1024+1;},
  (a:ReturnType<typeof artwork>)=>{a.assets.push({...asset});},
  (a:ReturnType<typeof artwork>)=>{a.extensions[NS].version=2;},
 ]){const a=artwork();change(a);expect(artworkThumbnailFor(a)).toBeUndefined();}
 expect(artworkThumbnailFor({primaryAssetId:primary,assets:[asset]})).toBeUndefined();
 expect(validateArtworkThumbnail({primaryAssetId:primary,assets:[asset]}).valid).toBe(true);
 expect(validateArtworkThumbnail({primaryAssetId:primary,assets:[asset],extensions:{[NS]:{version:2,assetId:id}}}).valid).toBe(false);
});
it('rejects malformed and oversized headers before image decoding',()=>{
 const make=(w:number,h:number)=>{const b=new ArrayBuffer(33),v=new DataView(b);[137,80,78,71,13,10,26,10].forEach((x,i)=>v.setUint8(i,x));v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,w);v.setUint32(20,h);return b;};
 expect(checkArtworkThumbnailPng(make(256,1))).toBe(true);
 for(const b of [make(257,1),make(1,0),new ArrayBuffer(32),new ArrayBuffer(512*1024+1)])expect(checkArtworkThumbnailPng(b)).toBe(false);
});
it('accepts only bounded explicit thumbnail framing',()=>{
 expect(checkedArtworkThumbnailView({kind:'default'})).toEqual({kind:'default'});
 expect(checkedArtworkThumbnailView({kind:'orbit',yaw:Math.PI,pitch:-1.4,zoom:3})).toEqual({kind:'orbit',yaw:Math.PI,pitch:-1.4,zoom:3});
 for(const v of [{kind:'default',url:'private'}, {kind:'orbit',yaw:Infinity,pitch:0,zoom:1},{kind:'orbit',yaw:0,pitch:1.5,zoom:1},{kind:'orbit',yaw:0,pitch:0,zoom:4}])expect(checkedArtworkThumbnailView(v)).toBeUndefined();
});
