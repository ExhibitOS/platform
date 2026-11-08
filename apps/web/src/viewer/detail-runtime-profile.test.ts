// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';import {matchesDetailRuntime,type DetailRuntimeProfile} from './detail-runtime-profile';
const profile:DetailRuntimeProfile={renderer:'Apple M1 Metal',platform:'macOS',browserBrand:'Google Chrome',browserVersion:'156.0.8078.79',samples:4,alpha:true,depth:true,antialias:true,preserveDrawingBuffer:true};
function gl(framebuffer:unknown=null){return {FRAMEBUFFER_BINDING:1,SAMPLES:2,isContextLost:()=>false,getParameter:(key:number)=>key===1?framebuffer:key===2?4:'Apple M1 Metal',getContextAttributes:()=>({alpha:true,depth:true,antialias:true,preserveDrawingBuffer:true}),getExtension:()=>({UNMASKED_RENDERER_WEBGL:3})} as unknown as WebGL2RenderingContext;}
it('matches only the exact observable renderer, default framebuffer and full browser version',async()=>{
 const hints={platform:'macOS',getHighEntropyValues:vi.fn(async()=>({fullVersionList:[{brand:'GREASE',version:'1'},{brand:'Google Chrome',version:'156.0.8078.79'}]}))},signal=new AbortController().signal;expect(await matchesDetailRuntime(profile,gl(),hints,signal)).toBe(true);expect(await matchesDetailRuntime({...profile,browserVersion:'156.0.0.0'},gl(),hints,signal)).toBe(false);expect(await matchesDetailRuntime(profile,gl({}),hints,signal)).toBe(false);expect(hints.getHighEntropyValues).toHaveBeenCalledTimes(2);expect(await matchesDetailRuntime(profile,gl(),undefined,signal)).toBe(false);
});
it('ignores a late client-hints result after cancellation',async()=>{
 let complete!:(v:{fullVersionList:Array<{brand:string;version:string}>})=>void;const hints={platform:'macOS',getHighEntropyValues:()=>new Promise<{fullVersionList:Array<{brand:string;version:string}>}>(r=>{complete=r})},abort=new AbortController();const context=gl(),probe=vi.spyOn(context,'getParameter');const pending=matchesDetailRuntime(profile,context,hints,abort.signal);await Promise.resolve();abort.abort();expect(await pending).toBe(false);const count=probe.mock.calls.length;complete({fullVersionList:[{brand:'Google Chrome',version:'156.0.8078.79'}]});await Promise.resolve();await Promise.resolve();expect(probe.mock.calls.length).toBe(count);
});
it('rechecks graphics state after the asynchronous client-hints result',async()=>{
 let framebuffer:unknown=null,complete!:(v:{fullVersionList:Array<{brand:string;version:string}>})=>void;const context=gl();context.getParameter=((key:number)=>key===1?framebuffer:key===2?4:'Apple M1 Metal') as typeof context.getParameter;const hints={platform:'macOS',getHighEntropyValues:()=>new Promise<{fullVersionList:Array<{brand:string;version:string}>}>(r=>{complete=r})};const result=matchesDetailRuntime(profile,context,hints,new AbortController().signal);await Promise.resolve();framebuffer={};complete({fullVersionList:[{brand:'Google Chrome',version:'156.0.8078.79'}]});expect(await result).toBe(false);
});
it('fails closed on malformed client-hint entries without an unhandled rejection',async()=>{
 const hints={platform:'macOS',getHighEntropyValues:async()=>({fullVersionList:[null,{brand:'Google Chrome'}]})};expect(await matchesDetailRuntime(profile,gl(),hints as never,new AbortController().signal)).toBe(false);
});
