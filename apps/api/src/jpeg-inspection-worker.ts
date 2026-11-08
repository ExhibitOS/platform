// SPDX-License-Identifier: AGPL-3.0-or-later
// Experimental, unregistered decoder worker. No publication or device admission.
import {createHash} from 'node:crypto';
import {Socket} from 'node:net';
import {inspectBaselineJpegStructure} from './jpeg-baseline-structure.ts';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const deadline=setTimeout(()=>process.exit(70),10000);
// Parent holds this private pipe open until termination; EOF means owner loss.
const owner=new Socket({fd:3,readable:true,writable:false});owner.once('end',()=>process.exit(70));owner.once('error',()=>process.exit(70));owner.resume();
try{
 const chunks:Buffer[]=[];let length=0;for await(const chunk of process.stdin){const part=Buffer.from(chunk);length+=part.length;if(length>25*1024*1024)throw Error('LIMIT');chunks.push(part);}
 const bytes=Buffer.concat(chunks),structure=inspectBaselineJpegStructure(bytes),sharp=(await import('sharp')).default;
 if(sharp.versions.sharp!=='0.35.4'||sharp.versions.vips!=='8.18.6'||sharp.versions.mozjpeg!=='0826579')throw Error('CODEC_VERSION');
 sharp.cache(false);sharp.concurrency(1);const options={failOn:'warning' as const,limitInputPixels:16000000,limitInputChannels:4,sequentialRead:true};
 const metadata=await sharp(bytes,options).metadata();if(metadata.format!=='jpeg'||metadata.width!==structure.width||metadata.height!==structure.height||metadata.channels!==3||metadata.depth!=='uchar'||metadata.isProgressive||(metadata.pages??1)!==1||(metadata.orientation??1)!==1||(metadata.icc?.length??0)!==structure.iccBytes||(metadata.icc?hash(metadata.icc):undefined)!==structure.iccSha256)throw Error('PROFILE');
 const decoded=await sharp(bytes,options).raw().toBuffer({resolveWithObject:true});if(decoded.info.width!==structure.width||decoded.info.height!==structure.height||decoded.info.channels!==3||decoded.data.length!==structure.width*structure.height*3)throw Error('DECODE');
 process.stdout.write(JSON.stringify({version:1,sourceSha256:hash(bytes),sourceBytes:bytes.length,width:structure.width,height:structure.height,iccBytes:structure.iccBytes,iccSha256:structure.iccSha256??null,decodedSha256:hash(decoded.data),decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'})+'\n');
}catch{process.stderr.write('JPEG_INSPECTION_FAILED\n');process.exitCode=1;}finally{clearTimeout(deadline);owner.destroy();}
