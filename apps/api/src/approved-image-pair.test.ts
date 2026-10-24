// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {qualifyApprovedImagePair} from './approved-lod-pair.ts';
// Header-only relationship witnesses; strict PNG decoding is a separate worker gate.
function header(width:number,height:number,size:number){const b=Buffer.alloc(size);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b[24]=8;b[25]=2;return b;}
test('authored PNG pair requires actual reduced detail/bytes and the same image rectangle',()=>{
 const full=header(1024,800,100),coarse=header(512,400,50);
 expect(()=>qualifyApprovedImagePair(full,coarse,1024,512)).not.toThrow();
 expect(()=>qualifyApprovedImagePair(full,header(512,450,50),1024,512)).toThrow('APPROVED_LOD_UNSUPPORTED');
 expect(()=>qualifyApprovedImagePair(full,header(512,400,101),1024,512)).toThrow('APPROVED_LOD_UNSUPPORTED');
 expect(()=>qualifyApprovedImagePair(full,coarse,1023,512)).toThrow('APPROVED_LOD_INVALID');
 expect(()=>qualifyApprovedImagePair(header(4096,2048,100),coarse,4096,512)).toThrow('APPROVED_LOD_INVALID');
});
