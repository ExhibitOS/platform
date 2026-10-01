import { inflateSync } from 'node:zlib';
import { validateBytes } from 'gltf-validator';
const LIMIT=32*1024*1024, PIXELS=4*1024*1024;
let count=0;const chunks:Buffer[]=[];
for await(const chunk of process.stdin){count+=chunk.length;if(count>LIMIT)process.exit(1);chunks.push(chunk);}
const bytes=Buffer.concat(chunks);
function fail():never{throw Error('invalid format');}
function crc(data:Buffer){let value=0xffffffff;for(const byte of data){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function png(data:Buffer){
 if(data.length<33||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
 let offset=8,width=0,height=0,channels=0,ended=false,seenIdat=false,closedIdat=false;const compressed:Buffer[]=[];
 let chunkCount=0;
 while(offset<data.length){
  if(++chunkCount>256||offset+12>data.length)fail();const size=data.readUInt32BE(offset),end=offset+12+size;if(end>data.length)fail();
  const kind=data.toString('latin1',offset+4,offset+8);if(!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind))fail();const body=data.subarray(offset+8,end-4);
  if(crc(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))fail();
  if(offset===8){if(kind!=='IHDR'||size!==13)fail();width=body.readUInt32BE(0);height=body.readUInt32BE(4);channels=body[9]===2?3:body[9]===6?4:0;if(!width||!height||width*height>PIXELS||width>8192||height>8192||body[8]!==8||!channels||body[10]!==0||body[11]!==0||body[12]!==0)fail();}
  else if(kind==='IDAT'){if(closedIdat)fail();seenIdat=true;compressed.push(body);}
  else if(kind==='IEND'){if(size!==0||!seenIdat||end!==data.length)fail();ended=true;}
  else{if(seenIdat)closedIdat=true;/* Conservative profile rejects all ancillary metadata and unknown critical chunks. */fail();}
  offset=end;
 }
 if(!ended)fail();const expanded=(width*channels+1)*height;
 const result=inflateSync(Buffer.concat(compressed),{maxOutputLength:expanded,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
 if(result.buffer.length!==expanded||result.engine.bytesWritten!==Buffer.concat(compressed).length)fail();
 // Validate and reconstruct every scanline, including Paeth dependencies.
 const stride=width*channels,rowBytes=stride+1;
 const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const start=y*rowBytes,type=result.buffer[start]!;if(type>4)fail();for(let x=0;x<stride;x++){const index=start+1+x,a=x>=channels?result.buffer[index-channels]!:0,b=y?result.buffer[index-rowBytes]!:0,c=y&&x>=channels?result.buffer[index-rowBytes-channels]!:0;const add=type===0?0:type===1?a:type===2?b:type===3?Math.floor((a+b)/2):paeth(a,b,c);result.buffer[index]=(result.buffer[index]!+add)&255;}}
}
async function glb(data:Buffer){
 if(data.length<20||data.toString('ascii',0,4)!=='glTF'||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length)fail();
 const jsonSize=data.readUInt32LE(12);if(jsonSize>1024*1024||20+jsonSize>data.length||data.readUInt32LE(16)!==0x4e4f534a)fail();
 const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(20,20+jsonSize)));
 // No extensions, embedded images or URI fetches in this first qualified profile.
 if(document.extensionsUsed?.length||document.extensionsRequired?.length)fail();
 const scan=(v:unknown,depth=0)=>{if(depth>64)fail();if(v&&typeof v==='object'){if(Array.isArray(v)){if(v.length>100000)fail();for(const x of v)scan(x,depth+1);}else for(const [k,x]of Object.entries(v)){if(k==='uri'||k==='extensions'||k==='images'||k==='textures')fail();scan(x,depth+1);}}};scan(document);
 const report=await validateBytes(data,{maxIssues:64,externalResourceFunction:()=>Promise.reject(Error('external resource forbidden'))});if(report.issues.numErrors)fail();
}
try{if(process.argv[2]==='image/png')png(bytes);else if(process.argv[2]==='model/gltf-binary')await glb(bytes);else fail();process.stdout.write('VALID\n');}catch{process.exitCode=1;}
