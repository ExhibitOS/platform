// SPDX-License-Identifier: AGPL-3.0-or-later
export interface DetailRuntimeProfile {renderer:string;platform:string;browserBrand:string;browserVersion:string;samples:number;alpha:boolean;depth:boolean;antialias:boolean;preserveDrawingBuffer:boolean}
type ClientHints={platform:string;getHighEntropyValues(hints:string[]):Promise<{fullVersionList?:Array<{brand:string;version:string}>}>};
/** Local applicability only; this does not attest device identity or grant rights. */
export async function matchesDetailRuntime(profile:DetailRuntimeProfile,gl:WebGL2RenderingContext,clientHints:ClientHints|undefined,signal:AbortSignal):Promise<boolean>{
 if(signal.aborted||!clientHints||clientHints.platform!==profile.platform)return false;
 const graphics=()=>{try{
  if(gl.isContextLost()||gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null)return false;
  const attrs=gl.getContextAttributes(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return !!attrs&&!!debug&&gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)===profile.renderer&&gl.getParameter(gl.SAMPLES)===profile.samples&&attrs.alpha===profile.alpha&&attrs.depth===profile.depth&&attrs.antialias===profile.antialias&&attrs.preserveDrawingBuffer===profile.preserveDrawingBuffer;
 }catch{return false;}};
 if(!graphics())return false;
 return new Promise<boolean>(resolve=>{
  let settled=false;const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);resolve(value);};
  const cancel=()=>finish(false),timer=setTimeout(cancel,1500);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}
  void Promise.resolve().then(()=>clientHints.getHighEntropyValues(['fullVersionList'])).then(value=>{if(settled)return;try{finish(!!value&&Array.isArray(value.fullVersionList)&&value.fullVersionList.some(item=>!!item&&typeof item==='object'&&item.brand===profile.browserBrand&&item.version===profile.browserVersion)&&!signal.aborted&&graphics());}catch{finish(false);}},()=>finish(false));
 });
}
