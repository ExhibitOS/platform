// SPDX-License-Identifier: AGPL-3.0-or-later
import {MAX_SPACE_STILL_BYTES,MAX_SPACE_STILL_DIMENSION,MAX_SPACE_STILL_PIXELS} from '@exhibitos/spec/space-still';
import {ApiError} from './api-error.ts';
import {decode} from './validation-client.ts';
export async function validateCoverImage(bytes:Buffer,hooks?:{onSpawn?:(child:import('node:child_process').ChildProcess)=>void}){
 if(bytes.length<33||bytes.length>MAX_SPACE_STILL_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw new ApiError(422,'COVER_IMAGE_INVALID');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>MAX_SPACE_STILL_DIMENSION||height>MAX_SPACE_STILL_DIMENSION||width*height>MAX_SPACE_STILL_PIXELS)throw new ApiError(422,'COVER_IMAGE_LIMIT');
 await decode(bytes,'image/png',hooks);
}
