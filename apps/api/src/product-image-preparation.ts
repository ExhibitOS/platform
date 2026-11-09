// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {decodePngPixels,pngCrc} from './png-pixels.ts';
export const PRODUCT_IMAGE_PROFILE='product-image-pair-2048-512-v1' as const;
export const PRODUCT_IMAGE_LIMITS={sourceBytes:33554432,pixels:25165824,edge:8192,iccBytes:1048576,outputBytes:8388608} as const;
export const PRODUCT_IMAGE_RECIPE={version:1,id:PRODUCT_IMAGE_PROFILE,decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579',source:'baseline-rgb8-jpeg-orientation1',colour:'embedded-icc-to-srgb-or-assumed-srgb',full:'nearest-centre-2048-then-1600-if-png-exceeds-cap',coarse:'partition-box-512-when-smaller',png:'rgb8-filter0-srgb0-zlib9',limits:PRODUCT_IMAGE_LIMITS} as const;
export const imageHash=(value:Buffer|object)=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const PRODUCT_IMAGE_RECIPE_SHA256=imageHash(PRODUCT_IMAGE_RECIPE);
export const FRESH_IMAGE_PROFILE='ordinary-image-preparation-v1' as const;
export const FRESH_IMAGE_RECIPE={...PRODUCT_IMAGE_RECIPE,id:FRESH_IMAGE_PROFILE,source:'baseline-rgb8-jpeg-orientation1-or-strict-rgb8-png-with-optional-pixel-density'} as const;
export const FRESH_IMAGE_RECIPE_SHA256=imageHash(FRESH_IMAGE_RECIPE);
type SourceMime='image/jpeg'|'image/png';
export interface ImageMetric {sha256:string;bytes:number;width:number;height:number}
export interface ProductImageProducerReceipt<Mime extends SourceMime='image/jpeg'> {version:1;recipeSHA256:string;decoder:string;source:ImageMetric&{mime:Mime;iccSHA256:string|null};full:ImageMetric;coarse?:ImageMetric}
export interface ProductImageOutput<Mime extends SourceMime='image/jpeg'> {full:Buffer;coarse?:Buffer;receipt:ProductImageProducerReceipt<Mime>}
const fail=(code='IMAGE_PREPARATION_PROFILE_UNSUPPORTED'):never=>{throw Error(code);};
function png(width:number,height:number,pixels:Buffer){
 const chunk=(name:string,body:Buffer)=>{const h=Buffer.alloc(8),tail=Buffer.alloc(4);h.writeUInt32BE(body.length);h.write(name,4);tail.writeUInt32BE(pngCrc(Buffer.concat([h.subarray(4),body])));return Buffer.concat([h,body,tail]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 const rows=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('sRGB',Buffer.from([0])),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
function fullDimensions(width:number,height:number,maxEdge:number){
 const ratio=Math.min(1,maxEdge/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};
}
export function validProductFullDimensions(source:Pick<ImageMetric,'width'|'height'>,full:Pick<ImageMetric,'width'|'height'>){
 return [2048,1600].some(edge=>{
  const allowed=fullDimensions(source.width,source.height,edge);
  return full.width===allowed.width&&full.height===allowed.height;
 });
}
function prepareFull(source:Buffer,sourceWidth:number,sourceHeight:number,maxEdge:number){
 const {width,height}=fullDimensions(sourceWidth,sourceHeight,maxEdge);
 const pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sy=Math.min(sourceHeight-1,Math.floor((y+0.5)*sourceHeight/height));
  const sx=Math.min(sourceWidth-1,Math.floor((x+0.5)*sourceWidth/width));
  const offset=(sy*sourceWidth+sx)*3;
  source.copy(pixels,(y*width+x)*3,offset,offset+3);
 }
 return {width,height,pixels,bytes:png(width,height,pixels)};
}
const metric=(b:Buffer,width:number,height:number):ImageMetric=>({sha256:imageHash(b),bytes:b.length,width,height});
export function validateProductImageOutput<Mime extends SourceMime>(result:ProductImageOutput<Mime>,source:{sha256:string;bytes:number},freshMime?:Mime){
 const expectedRecipe=freshMime?FRESH_IMAGE_RECIPE_SHA256:PRODUCT_IMAGE_RECIPE_SHA256;
 const r=result.receipt;if(!r||r.version!==1||r.recipeSHA256!==expectedRecipe||r.decoder!==PRODUCT_IMAGE_RECIPE.decoder||r.source.mime!==(freshMime??'image/jpeg')||r.source.mime==='image/png'&&r.source.iccSHA256!==null||r.source.sha256!==source.sha256||r.source.bytes!==source.bytes||!Number.isSafeInteger(r.source.width)||!Number.isSafeInteger(r.source.height)||r.source.width<1||r.source.height<1||Math.max(r.source.width,r.source.height)>PRODUCT_IMAGE_LIMITS.edge||r.source.width*r.source.height>PRODUCT_IMAGE_LIMITS.pixels||r.source.iccSHA256!==null&&!/^[a-f0-9]{64}$/.test(r.source.iccSHA256))fail('IMAGE_PREPARATION_RECEIPT_INVALID');
 if(!r.full||!validProductFullDimensions(r.source,r.full))fail('IMAGE_PREPARATION_RECEIPT_INVALID');
 const {width:w,height:h}=r.full;
 const check=(b:Buffer,m:ImageMetric,width:number,height:number)=>{if(!b||b.length>PRODUCT_IMAGE_LIMITS.outputBytes||m.bytes!==b.length||m.sha256!==imageHash(b)||m.width!==width||m.height!==height)fail('IMAGE_PREPARATION_RECEIPT_INVALID');const d=decodePngPixels(b);if(d.width!==width||d.height!==height||d.channels!==3||d.srgbIntent!==0)fail('IMAGE_PREPARATION_RECEIPT_INVALID');};
 check(result.full,r.full,w,h);const low=Math.min(1,512/Math.max(w,h));
 if(result.coarse!==undefined||r.coarse!==undefined){
  if(low===1||!result.coarse||!r.coarse||result.coarse.length>=result.full.length)fail('IMAGE_PREPARATION_RECEIPT_INVALID');
  check(result.coarse!,r.coarse!,Math.max(1,Math.round(w*low)),Math.max(1,Math.round(h*low)));
 }
}
/** Shared product producer. Input bytes remain untouched and never become PNG
 * authority merely because a caller supplied a conversion declaration. */
export function prepareProductImage(source:Buffer,identity:{sha256:string;bytes:number}):Promise<ProductImageOutput>{
 return prepareImage(source,identity,'image/jpeg',false);
}
export function prepareFreshImage<Mime extends SourceMime>(source:Buffer,identity:{sha256:string;bytes:number;mime:Mime}):Promise<ProductImageOutput<Mime>>{
 return prepareImage(source,identity,identity.mime,true);
}
async function prepareImage<Mime extends SourceMime>(source:Buffer,identity:{sha256:string;bytes:number},mime:Mime,fresh:boolean):Promise<ProductImageOutput<Mime>>{
 if(source.length!==identity.bytes||source.length<4||source.length>PRODUCT_IMAGE_LIMITS.sourceBytes||imageHash(source)!==identity.sha256)fail('IMAGE_PREPARATION_INPUT_INTEGRITY');
 if(mime==='image/png'&&fresh){
  const {width,height,channels,pixels}=decodePngPixels(source,PRODUCT_IMAGE_LIMITS.pixels,PRODUCT_IMAGE_LIMITS.edge,256,false,true);
  if(channels!==3)fail();
  // The decoder reconstructs scanlines in place and retains each row's filter byte.
  const rowBytes=width*3,rowStride=rowBytes+1;
  for(let y=0;y<height;y++){
   const rowStart=y*rowStride+1;
   pixels.copyWithin(y*rowBytes,rowStart,rowStart+rowBytes);
  }
  return prepareImagePixels(source,identity,mime,fresh,width,height,pixels.subarray(0,rowBytes*height),null);
 }
 if(mime!=='image/jpeg')return fail();
 const sharp=(await import('sharp')).default;if(sharp.versions.sharp!=='0.35.4'||sharp.versions.vips!=='8.18.6'||sharp.versions.mozjpeg!=='0826579')fail('IMAGE_PREPARATION_CODEC_VERSION');
 sharp.cache(false);sharp.concurrency(1);const options={limitInputPixels:PRODUCT_IMAGE_LIMITS.pixels,sequentialRead:true,failOn:'warning' as const};
 const m=await sharp(source,options).metadata();if(m.format!=='jpeg'||m.depth!=='uchar'||m.channels!==3||!m.width||!m.height||Math.max(m.width,m.height)>PRODUCT_IMAGE_LIMITS.edge||m.width*m.height>PRODUCT_IMAGE_LIMITS.pixels||m.isProgressive||(m.orientation??1)!==1||(m.pages??1)!==1||(m.icc?.length??0)>PRODUCT_IMAGE_LIMITS.iccBytes)fail();
 const {data,info}=await sharp(source,options).withIccProfile('srgb',{attach:false}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==m.width||info.height!==m.height||info.channels!==3||data.length!==m.width*m.height*3)fail();
 return prepareImagePixels(source,identity,mime,fresh,m.width,m.height,data,m.icc?imageHash(m.icc):null);
}
function prepareImagePixels<Mime extends SourceMime>(source:Buffer,identity:{sha256:string;bytes:number},mime:Mime,fresh:boolean,width:number,height:number,data:Buffer,iccSHA256:string|null):ProductImageOutput<Mime>{
 let prepared=prepareFull(data,width,height,2048);
 // At 1600px RGB scanlines fit the PNG byte cap even for incompressible inputs.
 if(prepared.bytes.length>PRODUCT_IMAGE_LIMITS.outputBytes)prepared=prepareFull(data,width,height,1600);
 const {width:w,height:h,pixels,bytes:full}=prepared;
 const receipt:ProductImageProducerReceipt<Mime>={version:1,recipeSHA256:fresh?FRESH_IMAGE_RECIPE_SHA256:PRODUCT_IMAGE_RECIPE_SHA256,decoder:PRODUCT_IMAGE_RECIPE.decoder,source:{...metric(source,width,height),mime,iccSHA256},full:metric(full,w,h)};
 let coarse:Buffer|undefined;const low=Math.min(1,512/Math.max(w,h));if(low<1){const lw=Math.max(1,Math.round(w*low)),lh=Math.max(1,Math.round(h*low)),out=Buffer.alloc(lw*lh*3);for(let y=0;y<lh;y++)for(let x=0;x<lw;x++)for(let c=0;c<3;c++){let sum=0,n=0;for(let sy=Math.floor(y*h/lh);sy<Math.max(Math.floor(y*h/lh)+1,Math.floor((y+1)*h/lh));sy++)for(let sx=Math.floor(x*w/lw);sx<Math.max(Math.floor(x*w/lw)+1,Math.floor((x+1)*w/lw));sx++){sum+=pixels[(sy*w+sx)*3+c]!;n++;}out[(y*lw+x)*3+c]=Math.round(sum/n);}const candidate=png(lw,lh,out);if(candidate.length<full.length){coarse=candidate;receipt.coarse=metric(coarse,lw,lh);}}
 const result={full,...(coarse?{coarse}:{}),receipt};validateProductImageOutput(result,identity,fresh?mime:undefined);return result;
}
