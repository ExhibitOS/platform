// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {validatePcmWav} from './audio.ts';
function wav(seconds=0.1,channels=1,rate=8000){const length=seconds*channels*rate*2,b=Buffer.alloc(44+length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length,40);return b;}
describe('bounded publication PCM WAV decoder',()=>{
 it('qualifies exact mono/stereo PCM16 bytes and duration',()=>{expect(validatePcmWav(wav())).toEqual({durationSeconds:0.1,channels:1,sampleRate:8000});expect(validatePcmWav(wav(60,2,48000)).durationSeconds).toBe(60);});
 it('rejects compressed, invalid alignment/rate, truncated and inconsistent RIFF inventory',()=>{for(const edit of [(b:Buffer)=>b.writeUInt16LE(3,20),(b:Buffer)=>b.writeUInt16LE(4,32),(b:Buffer)=>b.writeUInt32LE(96000,24),(b:Buffer)=>b.writeUInt32LE(1,4),(b:Buffer)=>b.writeUInt32LE(90000,40)]){const b=wav();edit(b);expect(()=>validatePcmWav(b)).toThrow('AUDIO_INVALID');}expect(()=>validatePcmWav(wav().subarray(0,40))).toThrow();});
 it('rejects over60seconds and metadata/unknown chunks',()=>{expect(()=>validatePcmWav(wav(61))).toThrow();const b=wav();b.write('LIST',36);expect(()=>validatePcmWav(b)).toThrow();});
});
