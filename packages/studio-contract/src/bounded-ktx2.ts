// SPDX-License-Identifier: AGPL-3.0-or-later
/** Closed embedded opaque UASTC/sRGB profile. Structural validation is not a transcoding or visual-quality proof. */
export function boundedKtx2(bytes: Uint8Array) {
  const bad=():never=>{throw Error('KTX2_PROFILE_INVALID');};
  if(bytes.byteLength<148||bytes.byteLength>8388608)bad();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=(at:number)=>v.getUint32(at,true);
  if(![171,75,84,88,32,50,48,187,13,10,26,10].every((x,i)=>bytes[i]===x))bad();
  const width=u(20),height=u(24);
  if(u(12)!==0||u(16)!==1||!width||!height||width>2048||height>2048||width%4||height%4||width*height>2097152||u(28)!==0||u(32)!==0||u(36)!==1||u(40)!==1||u(44)!==0)bad();
  const safe64=(at:number)=>{const n=v.getBigUint64(at,true);if(n>BigInt(Number.MAX_SAFE_INTEGER))bad();return Number(n);};
  const dfd=u(48),dfdLength=u(52),kvd=u(56),kvdLength=u(60),offset=safe64(80),length=safe64(88);
  if(dfd!==104||dfdLength!==44||safe64(64)!==0||safe64(72)!==0||offset%16||length!==width*height||safe64(96)!==length||offset+length!==bytes.length)bad();
  const dfdHex='2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff';
  if(!Array.from(bytes.subarray(dfd,dfd+44)).every((x,i)=>x===parseInt(dfdHex.slice(i*2,i*2+2),16)))bad();
  let end=dfd+dfdLength;
  if(kvdLength){
    if(kvd!==end||kvdLength>4096||kvd%4||kvdLength%4||kvd+kvdLength>offset)bad();
    const keys=new Set<string>();let at=kvd;
    while(at<kvd+kvdLength){
      if(at+4>kvd+kvdLength)bad();const n=u(at);at+=4;
      if(!n||at+n>kvd+kvdLength)bad();const entry=bytes.subarray(at,at+n),zero=entry.indexOf(0);
      if(zero<1)bad();const key=new TextDecoder('utf-8',{fatal:true}).decode(entry.subarray(0,zero));
      if(!['KTXwriter','KTXwriterScParams'].includes(key)||keys.has(key)||entry.subarray(zero+1).some(x=>x!==0&&(x<32||x>126)))bad();keys.add(key);
      at+=n;while(at%4){if(bytes[at++]!==0)bad();}
    }
    if(at!==kvd+kvdLength)bad();end=at;
  }else if(kvd!==0)bad();
  if(end>offset||offset-end>15||bytes.subarray(end,offset).some(x=>x!==0))bad();
  return {width,height,levelBytes:length};
}
/** Only texture-local optional KHR_texture_basisu is allowed; every compressed image has one PNG fallback. */
export function embeddedBasisPairs(doc: ReturnType<typeof JSON.parse>, imageBytes: (index:number)=>Uint8Array) {
  const bad=():never=>{throw Error('BASIS_GLTF_PROFILE_INVALID');};
  const pairs=new Map<number,number>();
  const used=doc.extensionsUsed;
  if(used!==undefined&&(!Array.isArray(used)||used.length>1||used.length===1&&used[0]!=='KHR_texture_basisu'))bad();
  if(doc.extensionsRequired!==undefined&&(!Array.isArray(doc.extensionsRequired)||doc.extensionsRequired.length))bad();
  const compressed=new Set<number>(),fallbacks=new Set<number>();let pixels=0,totalBytes=0;
  for(const texture of doc.textures??[]){
    if(texture.extensions===undefined)continue;
    const ext=texture.extensions;
    if(!ext||Object.keys(ext).length!==1||!Object.hasOwn(ext,'KHR_texture_basisu')||!ext.KHR_texture_basisu||Object.keys(ext.KHR_texture_basisu).length!==1)bad();
    const png=texture.source,ktx=ext.KHR_texture_basisu.source;
    if(!Number.isSafeInteger(png)||!Number.isSafeInteger(ktx)||png<0||ktx<0||png===ktx||compressed.has(ktx)||fallbacks.has(png)||doc.images?.[png]?.mimeType!=='image/png'||doc.images?.[ktx]?.mimeType!=='image/ktx2')bad();
    const k=imageBytes(ktx),info=boundedKtx2(k),p=imageBytes(png);if(p.length<24)bad();
    const pv=new DataView(p.buffer,p.byteOffset,p.byteLength);
    if(info.width!==pv.getUint32(16)||info.height!==pv.getUint32(20))bad();
    pixels+=info.width*info.height;totalBytes+=k.length;if(pixels>2097152||totalBytes>8388608)bad();
    compressed.add(ktx);fallbacks.add(png);pairs.set(ktx,png);
  }
  if(pairs.size&&(!used||used.length!==1))bad();
  if(!pairs.size&&used?.length)bad();
  for(let i=0;i<(doc.images?.length??0);i++)if(doc.images[i].mimeType==='image/ktx2'&&!compressed.has(i))bad();
  const scan=(value:unknown,depth=0):void=>{
    if(depth>64)bad();if(!value||typeof value!=='object')return;
    for(const [key,x] of Object.entries(value)){if(key==='uri'||key==='extensions'||key==='extensionsUsed'||key==='extensionsRequired')bad();scan(x,depth+1);}
  };
  const stripped=structuredClone(doc);delete stripped.extensionsUsed;delete stripped.extensionsRequired;
  for(const t of stripped.textures??[])delete t.extensions;
  scan(stripped);
  return pairs;
}
