// SPDX-License-Identifier: AGPL-3.0-or-later
import {nativeThumbnailHost} from './native-thumbnail-host';
const host=nativeThumbnailHost();
declare global {interface Window {exhibitosThumbnail?:typeof host}}
Object.defineProperty(window,'exhibitosThumbnail',{value:host,writable:false,configurable:false});
window.addEventListener('pagehide',()=>{void host.dispose();},{once:true});
