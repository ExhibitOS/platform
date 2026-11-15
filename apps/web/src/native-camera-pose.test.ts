// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {clearNativeCameraPose,publishNativeCameraPose} from './native-camera-pose';
const frameToken='11111111-1111-4111-8111-111111111111:7';
const sample=()=>({frameToken,appliedToken:frameToken,available:true,current:()=>true,position:[1,2,3],target:[4,5,6]});
it('publishes only copied actual position and exact orbit target under the accepted frame',()=>{
 const dataset:DOMStringMap={},input={...sample(),requestedPose:[99,99,99],csrfToken:'secret'};
 publishNativeCameraPose(dataset,input);expect(JSON.parse(dataset.nativeCameraPose!)).toEqual({version:1,frameToken,position:[1,2,3],target:[4,5,6]});
 input.position[0]=99;input.target[0]=88;expect(JSON.parse(dataset.nativeCameraPose!).position).toEqual([1,2,3]);expect(dataset.nativeCameraPose).not.toContain('secret');
});
it('clears the old sample on unavailable, retired or unapplied frames without affecting rendering',()=>{
 const cases=[{...sample(),available:false},{...sample(),current:()=>false},{...sample(),appliedToken:undefined},{...sample(),appliedToken:frameToken+'0'},{...sample(),current:()=>{throw Error('secret failure');}}];
 for(const input of cases){const dataset:DOMStringMap={nativeCameraPose:'old'};expect(()=>publishNativeCameraPose(dataset,input)).not.toThrow();expect(dataset.nativeCameraPose).toBeUndefined();}
 const current=vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),dataset:DOMStringMap={nativeCameraPose:'old'};publishNativeCameraPose(dataset,{...sample(),current});expect(current).toHaveBeenCalledTimes(2);expect(dataset.nativeCameraPose).toBeUndefined();
});
it('enforces exact finite bounded vectors and the existing squared separation threshold',()=>{
 for(const position of [[1,2],[1,2,3,4],[NaN,2,3],[Infinity,2,3],[10000.01,2,3],['1',2,3],new Array(3),null]){const dataset:DOMStringMap={nativeCameraPose:'old'};publishNativeCameraPose(dataset,{...sample(),position});expect(dataset.nativeCameraPose).toBeUndefined();}
 for(const target of [[1,2,3],[0.000001,0,0]]){const dataset:DOMStringMap={};publishNativeCameraPose(dataset,{...sample(),position:target[0]===1?[1,2,3]:[0,0,0],target});expect(dataset.nativeCameraPose).toBeUndefined();}
 const dataset:DOMStringMap={};publishNativeCameraPose(dataset,{...sample(),position:[10000,-10000,0],target:[9999,-9999,0]});expect(dataset.nativeCameraPose).toBeDefined();
 publishNativeCameraPose(dataset,{...sample(),position:[0,0,0],target:[0.0000011,0,0]});expect(dataset.nativeCameraPose).toBeDefined();
});
it('rejects malformed or unsafe frame tokens rather than exporting arbitrary text',()=>{
 for(const bad of ['secret',frameToken+'\n',frameToken.replace(':7',':0'),frameToken.replace(':7',':07'),frameToken.replace(':7',':-1'),frameToken.replace(':7',':9007199254740992')]){const dataset:DOMStringMap={nativeCameraPose:'old'};publishNativeCameraPose(dataset,{...sample(),frameToken:bad,appliedToken:bad});expect(dataset.nativeCameraPose).toBeUndefined();}
});
it('keeps default paths absent and clears retired lifecycle data',()=>{
 const dataset:DOMStringMap={};publishNativeCameraPose(dataset);expect(dataset).toEqual({});publishNativeCameraPose(dataset,sample());clearNativeCameraPose(dataset);expect(dataset).toEqual({});
 const position=Object.defineProperty([1,2,3],0,{get(){throw Error('secret getter');}});expect(()=>publishNativeCameraPose(dataset,{...sample(),position})).not.toThrow();expect(dataset).toEqual({});
});
