// Test-only synthetic resize measurement; no product caller.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {decodePngPixels,pngCrc} from './png-pixels.ts';
import {renderPngDerivative} from './png-display-derivative.ts';
const cases=[[2721,3722,2634,1926,2634],[3792,4000,2552,2419,2552],[4000,2551,2135,2135,1362]],max=8*1024*1024,hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='child'){
 const [sw,sh,edge,ow,oh]=cases[Number(process.argv[3])]??[];if(!sw)throw Error('case');
 const input=readFileSync(process.argv[4]),before=hash(input);if(input.length>max)throw Error('input bytes');
 const t=performance.now(),output=renderPngDerivative(input,edge,false,{version:1,mode:'none'},sw*sh,Math.max(sw,sh),256),elapsedMs=performance.now()-t;
 if(output.length>max||hash(input)!==before)throw Error('byte bound or mutation');
 const decoded=decodePngPixels(output,ow*oh,Math.max(ow,oh),256);if(decoded.width!==ow||decoded.height!==oh||decoded.channels!==3||decoded.srgbIntent!==1||ow>sw||oh>sh)throw Error('dimensions');
 for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){const sx=Math.floor(x*sw/ow),at=y*(ow*3+1)+1+x*3;if(decoded.pixels[at]!==sx%256||decoded.pixels[at+1]!==7*sx%256||decoded.pixels[at+2]!==13*sx%256)throw Error('sampling');}
 console.log(JSON.stringify({source:[sw,sh],output:[ow,oh],sourceSha256:before,outputSha256:hash(output),rawSha256:hash(decoded.pixels),inputBytes:input.length,outputBytes:output.length,elapsedMs,sourceUnchanged:true,nearestAllPixels:true}));if(elapsedMs>5000)process.exitCode=1;
}else{
 const [expectedHead,out]=process.argv.slice(2);if(!out||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==expectedHead)throw Error('source mismatch');mkdirSync(out,{recursive:false});
 const chunk=(name,data)=>{const n=Buffer.alloc(4),crc=Buffer.alloc(4),type=Buffer.from(name);n.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([type,data])));return Buffer.concat([n,type,data,crc]);},results=[];
 for(const [index,[w,h]] of cases.entries()){
  const t=performance.now(),row=Buffer.alloc(w*3+1);for(let x=0;x<w;x++){row[1+3*x]=x%256;row[2+3*x]=7*x%256;row[3+3*x]=13*x%256;}const raw=Buffer.alloc(row.length*h);for(let y=0;y<h;y++)row.copy(raw,y*row.length);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('sRGB',Buffer.from([1])),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);if(png.length>max)throw Error('input bytes');const path=`${out}/synthetic-${index}.png`;writeFileSync(path,png,{flag:'wx'});const generationMs=performance.now()-t;
  const start=performance.now(),child=spawnSync('/usr/bin/time',['-l',process.execPath,'--max-old-space-size=128','--experimental-strip-types',process.argv[1],'child',String(index),path],{encoding:'utf8'}),wallMs=performance.now()-start,rss=child.stderr.match(/(\d+)\s+maximum resident set size/);results.push({case:cases[index],pattern:'RGB8 filter 0 identical rows; channels x%256,(7*x)%256,(13*x)%256; zlib default',generationMs,workerWallMs:wallMs,peakRssBytes:rss?Number(rss[1]):null,exit:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr});if(child.status!==0||child.signal||wallMs>5000)break;
 }
 const report={head:expectedHead,results};writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});if(results.length!==3||results.some(x=>x.exit!==0||x.workerWallMs>5000))process.exitCode=1;
}
