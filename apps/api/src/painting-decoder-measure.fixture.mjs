// Test-only synthetic measurement; never imported by the product.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync, execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {decodePngPixels, pngCrc} from './png-pixels.ts';
const cases=[[1925,2634],[2419,2552],[2135,1361]], maxBytes=8*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='child'){
 const [w,h]=cases[Number(process.argv[3])]??[]; if(!w||!h)throw Error('case');
 const b=readFileSync(process.argv[4]); if(b.length>maxBytes)throw Error('encoded bytes');
 const t=performance.now(), decoded=decodePngPixels(b,w*h,Math.max(w,h)); const elapsedMs=performance.now()-t;
 const result={width:decoded.width,height:decoded.height,channels:decoded.channels,rawBytes:decoded.pixels.length,rawSha256:hash(decoded.pixels),inputSha256:hash(b),inputBytes:b.length,elapsedMs};
 if(decoded.width!==w||decoded.height!==h||decoded.channels!==3||decoded.pixels.length!==(w*3+1)*h||result.rawSha256!==process.argv[5])throw Error('decoded mismatch');
 console.log(JSON.stringify(result)); process.exitCode=elapsedMs<=5000?0:1;
}else{
 const [expectedHead,out]=process.argv.slice(2); if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==expectedHead||!out)throw Error('source mismatch');
 mkdirSync(out,{recursive:false}); const results=[];
 const chunk=(name,data)=>{const n=Buffer.alloc(4),crc=Buffer.alloc(4),type=Buffer.from(name);n.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([type,data])));return Buffer.concat([n,type,data,crc]);};
 for(const [index,[w,h]] of cases.entries()){
  const t=performance.now(), row=Buffer.alloc(w*3+1); for(let x=0;x<w;x++){row[1+3*x]=x%256;row[2+3*x]=(x*7)%256;row[3+3*x]=(x*13)%256;}
  const raw=Buffer.alloc(row.length*h);for(let y=0;y<h;y++)row.copy(raw,y*row.length);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);if(png.length>maxBytes)throw Error('fixture exceeds 8 MiB');
  const path=`${out}/synthetic-${index}.png`;writeFileSync(path,png,{flag:'wx'});const rawHash=hash(raw),generationMs=performance.now()-t;
  const start=performance.now();const child=spawnSync('/usr/bin/time',['-l',process.execPath,'--max-old-space-size=128','--experimental-strip-types',process.argv[1],'child',String(index),path,rawHash],{encoding:'utf8'});const wallMs=performance.now()-start;
  const rss=child.stderr.match(/(\d+)\s+maximum resident set size/);results.push({case:[w,h],pattern:'RGB8 unfiltered identical rows; channels x%256,(7*x)%256,(13*x)%256; zlib default',generationMs,workerWallMs:wallMs,peakRssBytes:rss?Number(rss[1]):null,exit:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr});
  if(child.status!==0||child.signal)break;
 }
 const report={head:expectedHead,results};writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));if(results.length!==3||results.some(x=>x.exit!==0))process.exitCode=1;
}
