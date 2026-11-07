// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MemoryAssetCache} from '../viewer/loading';

/** Publication-scoped verified bytes only. Active decoders pin their backing;
 * a delayed release after teardown removes the final retained cache entry. */
export class PublicWorkspaceCache {
 private readonly keys=new Set<string>();private active=true;
 constructor(private readonly cache:MemoryAssetCache<ArrayBuffer>){}
 get(key:string){if(!this.active)return undefined;const bytes=this.cache.acquire(key);if(!bytes)return undefined;this.keys.add(key);let released=false;return {bytes,release:()=>{if(released)return;released=true;this.cache.release(key);if(!this.active)this.cache.delete(key);}};}
 put(key:string,bytes:ArrayBuffer){if(!this.active||this.cache.get(key))return;if(this.cache.set(key,bytes,bytes.byteLength))this.keys.add(key);}
 dispose(){if(!this.active)return;this.active=false;for(const key of this.keys)this.cache.delete(key);this.keys.clear();}
}
