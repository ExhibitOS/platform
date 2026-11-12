// SPDX-License-Identifier: AGPL-3.0-or-later
import {AssetReleaseUnconfirmedError} from './loading';

type Resource={dispose():void|Promise<void>};
type DecodeBacking={dispose():void;drain():Promise<void>;retire():void;cleanupOK():boolean};

/** Close incoming callbacks first. Keep the transcoder and encoded pin alive
 * until its children finish; terminating a worker before drain can strand it.
 * A rejected cleanup is not a positive release receipt. */
export async function retireArtworkResources(resources:readonly Resource[],backing?:DecodeBacking){
 let failed=false,cause:unknown;
 const attempt=async(work:()=>void|Promise<void>)=>{try{await work();}catch(error){failed=true;cause??=error;}};
 if(backing){await attempt(()=>backing.dispose());await attempt(()=>backing.drain());}
 for(const resource of new Set(resources))await attempt(()=>resource.dispose());
 if(backing){await attempt(()=>backing.retire());try{if(!backing.cleanupOK())failed=true;}catch(error){failed=true;cause??=error;}}
 if(failed)throw new AssetReleaseUnconfirmedError({cause});
}

/** Transfer a prepared allocation into the existing reservation synchronously,
 * before any rights await can let expiry or pressure dispose the cached object.
 * A failed reservation restores the cache; failed authority retires the claim. */
export async function claimPreparedArtwork<T>(input:{
 pool:Map<string,T>;assetId:string;reserve(value:T):void;
 authorize():Promise<void>;check():void;dispose(value:T):void|Promise<void>;
}):Promise<T|undefined>{
 const value=input.pool.get(input.assetId);if(value===undefined)return;
 input.pool.delete(input.assetId);
 try{input.reserve(value);}catch(error){input.pool.set(input.assetId,value);throw error;}
 try{await input.authorize();input.check();return value;}
 catch(error){try{await input.dispose(value);}catch(cause){throw new AssetReleaseUnconfirmedError({cause});}throw error;}
}

/** A superseded source can stop waiting, but it cannot erase the previous
 * source's real retirement obligation for the next renderer generation. */
export async function waitForArtworkRetirement(retirement:Promise<void>,signal:AbortSignal){
 signal.throwIfAborted();
 let abort:()=>void=()=>{};
 const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
 try{await Promise.race([retirement,cancelled]);signal.throwIfAborted();}
 finally{signal.removeEventListener('abort',abort);}
}
export function joinArtworkRetirement(previous:Promise<void>,release:()=>void|Promise<void>):Promise<void>{
 let own:Promise<void>;try{own=Promise.resolve(release());}catch(error){own=Promise.reject(error);}
 const joined=Promise.all([previous,own]).then(()=>{});
 // React cleanup cannot await. Keep the rejected barrier for successors while
 // attaching a sink to avoid an unhandled rejection after a full unmount.
 void joined.catch(()=>{});return joined;
}
