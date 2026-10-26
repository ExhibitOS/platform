// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import type {Camera,Object3D,Scene,WebGLRenderer} from 'three';
/** Native-only installer; the public renderer imports no placement implementation. */
export interface PlacementPreviewContext {
 scene:Scene;model:Object3D;camera:Camera;renderer:WebGLRenderer;
 rooms:Map<string,Object3D>;surfaces:Map<string,Object3D>;
 load:(artwork:Artwork,signal:AbortSignal)=>Promise<{object:Object3D;release:()=>void}>;
 render:()=>void;
}
export type PlacementPreviewInstaller=(context:PlacementPreviewContext)=>{sync:()=>void;dispose:()=>void};
