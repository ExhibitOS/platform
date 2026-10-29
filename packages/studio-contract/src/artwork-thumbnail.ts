// SPDX-License-Identifier: AGPL-3.0-or-later
/** Optional, revision-scoped reference to an artwork's prepared small image. */
export const ARTWORK_THUMBNAIL_NAMESPACE='org.exhibitos.viewer/thumbnail';
export const MAX_ARTWORK_THUMBNAIL_BYTES=512*1024;
export const MAX_ARTWORK_THUMBNAIL_EDGE=256;
export type ArtworkThumbnailView={kind:'default'}|{kind:'orbit';yaw:number;pitch:number;zoom:number};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Private producer framing, independent of the exhibition camera. */
export function checkedArtworkThumbnailView(value:unknown):ArtworkThumbnailView|undefined{
 if(!object(value))return;
 const keys=Object.keys(value).sort().join(',');
 if(keys==='kind'&&value.kind==='default')return {kind:'default'};
 if(keys!=='kind,pitch,yaw,zoom'||value.kind!=='orbit'||typeof value.yaw!=='number'||typeof value.pitch!=='number'||typeof value.zoom!=='number'||![value.yaw,value.pitch,value.zoom].every(Number.isFinite)||Math.abs(value.yaw)>Math.PI||Math.abs(value.pitch)>1.4||value.zoom<.5||value.zoom>3)return;
 return {kind:'orbit',yaw:value.yaw,pitch:value.pitch,zoom:value.zoom};
}

/** Invalid or legacy metadata never selects an arbitrary preview asset. */
export function artworkThumbnailFor(artwork:unknown){
 if(!object(artwork)||!object(artwork.extensions))return undefined;
 const value=artwork.extensions[ARTWORK_THUMBNAIL_NAMESPACE];
 if(!object(value)||Object.keys(value).length!==2||value.version!==1||typeof value.assetId!=='string'||!uuid.test(value.assetId)||!Array.isArray(artwork.assets))return undefined;
 const matches=artwork.assets.filter((asset:unknown)=>object(asset)&&typeof asset.id==='string'&&asset.id.toLowerCase()===(value.assetId as string).toLowerCase());
 const asset=matches[0];
 if(matches.length!==1||!object(asset)||asset.role!=='preview'||asset.mime!=='image/png'||typeof asset.path!=='string'||!asset.path.endsWith('.png')||!Number.isSafeInteger(asset.bytes)||Number(asset.bytes)<1||Number(asset.bytes)>MAX_ARTWORK_THUMBNAIL_BYTES||typeof asset.sha256!=='string'||!/^[a-f0-9]{64}$/.test(asset.sha256)||typeof artwork.primaryAssetId!=='string'||artwork.primaryAssetId.toLowerCase()===value.assetId.toLowerCase())return undefined;
 return asset as {id:string;role:'preview';mime:'image/png';bytes:number;sha256:string;path:string};
}

/** Absence is valid for legacy artworks; a present malformed reference is not. */
export function validateArtworkThumbnail(artwork:unknown){
 const present=object(artwork)&&object(artwork.extensions)&&Object.hasOwn(artwork.extensions,ARTWORK_THUMBNAIL_NAMESPACE);
 const errors=present&&!artworkThumbnailFor(artwork)?[{code:'ARTWORK_THUMBNAIL_INVALID',path:'/extensions/org.exhibitos.viewer~1thumbnail',message:'Expected one bounded PNG preview in this artwork inventory'}]:[];
 return {valid:errors.length===0,errors};
}

/** Header admission happens before decoding; content integrity is checked separately. */
export function checkArtworkThumbnailPng(bytes:ArrayBuffer){
 if(bytes.byteLength<33||bytes.byteLength>MAX_ARTWORK_THUMBNAIL_BYTES)return false;
 const view=new DataView(bytes),signature=[137,80,78,71,13,10,26,10];
 if(signature.some((v,i)=>view.getUint8(i)!==v)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452)return false;
 const width=view.getUint32(16),height=view.getUint32(20);
 return width>0&&height>0&&width<=MAX_ARTWORK_THUMBNAIL_EDGE&&height<=MAX_ARTWORK_THUMBNAIL_EDGE;
}
