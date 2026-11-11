import {expect,test} from 'vitest';
import {deflateSync} from 'node:zlib';
import {decodePngPixels,pngCrc} from './png-pixels.ts';
import {renderPngDerivative} from './png-display-derivative.ts';
function chunk(name:string,b:Buffer){const n=Buffer.alloc(4),c=Buffer.alloc(4),t=Buffer.from(name);n.writeUInt32BE(b.length);c.writeUInt32BE(pngCrc(Buffer.concat([t,b])));return Buffer.concat([n,t,b,c]);}
function image(w:number,h:number){const ihdr=Buffer.alloc(13),raw=Buffer.alloc((w*3+1)*h);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw.set([x%256,y%256,(x+y)%256],y*(w*3+1)+1+x*3);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('sRGB',Buffer.from([1])),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
test('ordinary round and role floor preserve their distinct nearest sampling',()=>{
 const src=image(7,5),none={version:1 as const,mode:'none' as const};
 expect(renderPngDerivative(src,8,false,none,4194304,8192,256)).toEqual(src);
 for(const [role,h] of [[false,3],[true,2]] as const){const output=renderPngDerivative(src,4,role,none,4194304,8192,256),decoded=decodePngPixels(output);expect([decoded.width,decoded.height,decoded.srgbIntent]).toEqual([4,h,1]);const x=1,y=1,sx=Math.floor((x+(role ? .5 : 0))*7/4),sy=Math.floor((y+(role ? .5 : 0))*5/h),at=y*(4*3+1)+1+x*3;expect([...decoded.pixels.subarray(at,at+3)]).toEqual([sx,sy,sx+sy]);}
});
