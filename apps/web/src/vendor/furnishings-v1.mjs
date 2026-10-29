// SPDX-License-Identifier: Apache-2.0
/** Optional, inert inventory carrier. Catalog/material/geometry qualification belongs to consumers. */
export const FURNISHING_NAMESPACE='org.exhibitos.studio/furnishing-visuals';
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export const OEX_FURNISHING_VERSION='1.0.0-draft.6';
const hashDescriptor=v=>closed(v,['path','bytes','sha256'])&&typeof v.path==='string'&&Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=32768&&hash(v.sha256);
const url=v=>{if(typeof v!=='string'||v.length>2048)return false;try{const x=new URL(v);return x.protocol==='https:'&&!x.username&&!x.password&&!x.search&&!x.hash;}catch{return false;}};
export function validateFurnishingInventory(revision){
 const errors=[],base='/extensions/org.exhibitos.studio~1furnishing-visuals',fail=message=>errors.push({code:'FURNISHING_INVENTORY_INVALID',path:base,message});
 const value=revision?.extensions?.[FURNISHING_NAMESPACE];
 if(!Object.hasOwn(revision?.extensions??{},FURNISHING_NAMESPACE))return {valid:true,errors,assets:[]};
 if(!closed(value,['version','assets','bindings'])||value.version!==1||!Array.isArray(value.assets)||!value.assets.length||value.assets.length>8||!Array.isArray(value.bindings)||!value.bindings.length||value.bindings.length>32){fail('Expected closed version1 with1..8 assets and1..32 placed bindings');return {valid:false,errors,assets:[]};}
 const ids=new Set(),recipes=new Set(),used=new Set(),hosts=new Set();
 const existing=new Set(['rooms','surfaces','openings','artworks','placements','lights','mediaAssets'].flatMap(k=>(revision[k]??[]).flatMap(v=>[v.id,v.revisionId,...(v.assets??[]).map(a=>a.id)])).filter(Boolean).map(v=>v.toLowerCase()));
 const benches=revision.extensions?.['org.exhibitos.studio/benches']?.benches;
 for(const id of [revision.extensions?.['org.exhibitos.viewer/space-still']?.asset?.id,...(Array.isArray(benches)?benches:[]).map(b=>object(b)?b.id:undefined)])if(typeof id==='string')existing.add(id.toLowerCase());
 for(const a of value.assets){
  if(!closed(a,['id','catalogId','catalogVersion','mime','path','bytes','sha256','rights','provenance'])||!uuid(a.id)||typeof a.catalogId!=='string'||!/^[-a-z0-9]{1,64}$/.test(a.catalogId)||!Number.isSafeInteger(a.catalogVersion)||a.catalogVersion<1||a.catalogVersion>2147483647||a.mime!=='model/gltf-binary'||a.path!==`furnishings/${a.id}/model.glb`||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>25*1024*1024||!hash(a.sha256)||!validRights(a)||!closed(a.provenance,['sourceSha256','recipe'])||!((a.provenance.recipe==='original-v1'&&a.provenance.sourceSha256===a.sha256)||(a.provenance.recipe==='omit-unused-tangent-v1'&&hash(a.provenance.sourceSha256)&&a.provenance.sourceSha256!==a.sha256))){
   fail('Expected bounded self-contained GLB inventory with explicit CC0 source and explicit source-byte provenance');continue;
  }
  const id=a.id.toLowerCase(),recipe=`${a.catalogId}:${a.catalogVersion}:${a.sha256}`;
  if(ids.has(id)||existing.has(id)||recipes.has(recipe))fail('Asset identities must be unique and identical catalog instances must share one inventory item');ids.add(id);recipes.add(recipe);
 }
 for(const b of value.bindings){
  if(!closed(b,['hostKind','hostId','assetId','pose'])||!['pedestal','bench','light','opening'].includes(b.hostKind)||!uuid(b.hostId)||!uuid(b.assetId)||!closed(b.pose,['position','yaw','scale'])||!Array.isArray(b.pose.position)||b.pose.position.length!==3||!b.pose.position.every(n=>finite(n,-10000,10000))||!finite(b.pose.yaw,-Math.PI,Math.PI)||!finite(b.pose.scale,.1,4)){
   fail('Expected typed existing host and an explicit bounded uniform metre pose');continue;
  }
  const key=b.hostKind+':'+b.hostId.toLowerCase(),rows=b.hostKind==='pedestal'?revision.placements:b.hostKind==='bench'?revision.extensions?.['org.exhibitos.studio/benches']?.benches:b.hostKind==='light'?revision.lights:revision.openings;
  if(hosts.has(key)||!Array.isArray(rows)||!rows.some(r=>typeof r.id==='string'&&r.id.toLowerCase()===b.hostId.toLowerCase())||!ids.has(b.assetId.toLowerCase()))fail('Binding must reference one unique existing host and declared asset');hosts.add(key);used.add(b.assetId.toLowerCase());
 }
 if(ids.size!==used.size||[...ids].some(id=>!used.has(id)))fail('Every declared furnishing asset must be placed; unused originals/catalog items are forbidden');
 return {valid:errors.length===0,errors,assets:errors.length?[]:value.assets};
}
export function packageFurnishingAssetManifest(revision){
 const checked=validateFurnishingInventory(revision);if(!checked.valid)throw Error('FURNISHING_INVENTORY_INVALID');
 return checked.assets.map((a,i)=>({id:a.id,kind:'furnishing',path:'assets/'+a.path,artifactPath:a.path,mime:a.mime,bytes:a.bytes,sha256:a.sha256,rightsReferences:[`exhibition.json#/extensions/org.exhibitos.studio~1furnishing-visuals/assets/${i}/rights`],provenanceReferences:[`exhibition.json#/extensions/org.exhibitos.studio~1furnishing-visuals/assets/${i}/provenance`]})).sort((a,b)=>a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
}

function validRights(asset){
 const rights=asset.rights;
 if(closed(rights,['licenseId','notice'])&&rights.licenseId==='CC0-1.0'&&hashDescriptor(rights.notice))return rights.notice.path===`furnishings/${asset.id}/LICENSE-NOTICE.txt`;
 return closed(rights,['licenseId','creditLine','source','licenseSource'])&&rights.licenseId==='CC0-1.0'&&typeof rights.creditLine==='string'&&!!rights.creditLine.trim()&&rights.creditLine.length<=2048&&url(rights.source)&&url(rights.licenseSource);
}
export function packageFurnishingNoticeManifest(revision){
 const checked=validateFurnishingInventory(revision);if(!checked.valid)throw Error('FURNISHING_INVENTORY_INVALID');
 return checked.assets.filter(a=>a.rights.notice).map(a=>({assetId:a.id,mime:'text/plain; charset=utf-8',path:'resources/'+a.rights.notice.path,artifactPath:a.rights.notice.path,bytes:a.rights.notice.bytes,sha256:a.rights.notice.sha256})).sort((a,b)=>a.assetId.toLowerCase().localeCompare(b.assetId.toLowerCase()));
}
