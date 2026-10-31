// SPDX-License-Identifier: AGPL-3.0-or-later
// Validates structure and inventory binding only. The producing service must
// establish that the derived image corresponds to the approved primary.
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names)=>object(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(',');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
const image=v=>keys(v,['assetId','mime','sha256','bytes','width','height'])&&typeof v.assetId==='string'&&uuid.test(v.assetId)&&v.mime==='image/png'&&typeof v.sha256==='string'&&hash.test(v.sha256)&&Number.isSafeInteger(v.bytes)&&v.bytes>=33&&v.bytes<=8388608&&Number.isSafeInteger(v.width)&&v.width>=1&&v.width<=4096&&Number.isSafeInteger(v.height)&&v.height>=1&&v.height<=4096&&v.width*v.height<=4194304;
export function validateCoverVariantDescriptor(publication){
 const value=publication?.coverVariants,revision=publication?.publication?.revisionSha256,exhibition=publication?.exhibition;
 if(!keys(value,['version','revisionSha256','primary','variants'])||value.version!==1||typeof revision!=='string'||!hash.test(revision)||value.revisionSha256!==revision||!image(value.primary)||!Array.isArray(value.variants)||value.variants.length<1||value.variants.length>2||!value.variants.every(image)||!Array.isArray(exhibition?.artworks)||exhibition.artworks.length>10000||!Array.isArray(publication.assets)||publication.assets.length>20000)return false;
 const selected=exhibition.extensions?.['org.exhibitos.viewer/entrance']?.imageAssetId;
 if(typeof selected!=='string'||selected.toLowerCase()!==value.primary.assetId.toLowerCase())return false;
 const matches=exhibition.artworks.filter(a=>a?.artworkType==='image'&&typeof a.primaryAssetId==='string'&&a.primaryAssetId.toLowerCase()===selected.toLowerCase());
 if(matches.length!==1||!Array.isArray(matches[0].assets)||matches[0].assets.length>64)return false;
 const artwork=matches[0],seen=new Set();
 for(const item of [value.primary,...value.variants]){
  const id=item.assetId.toLowerCase(),a=artwork.assets.filter(x=>typeof x?.id==='string'&&x.id.toLowerCase()===id),p=publication.assets.filter(x=>typeof x?.assetId==='string'&&x.assetId.toLowerCase()===id);
  if(seen.has(id)||a.length!==1||p.length!==1||a[0].id!==p[0].assetId||a[0].mime!==item.mime||a[0].role!=='image'||a[0].bytes!==item.bytes||a[0].sha256!==item.sha256||p[0].mime!==item.mime||p[0].url!==`/api/v1/publications/${publication.publication.id}/assets/${p[0].assetId}`)return false;
  if(item!==value.primary&&(item.bytes>=value.primary.bytes||item.width>value.primary.width||item.height>value.primary.height||Math.abs(item.width*value.primary.height-item.height*value.primary.width)>value.primary.width+value.primary.height||Math.abs(item.width*value.primary.height-item.height*value.primary.width)>Math.max(item.width*value.primary.height,item.height*value.primary.width)/100))return false;
  seen.add(id);
 }
 return true;
}
