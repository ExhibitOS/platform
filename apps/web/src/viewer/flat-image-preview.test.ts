// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import * as three from 'three';
import {flatImagePreview} from './flat-image-preview';
test('uses an orthographic unlit quad and swaps only the borrowed map; source resources survive',()=>{
 const texture=new three.Texture({width:2400,height:1200} as unknown as TexImageSource),geometry=new three.PlaneGeometry(2,3),material=new three.MeshStandardMaterial({map:texture});
 const object=new three.Mesh(geometry,material);object.rotation.set(1,2,3);object.position.set(4,5,6);object.updateMatrixWorld();const before=object.matrixWorld.toArray();
 const disposeTexture=vi.spyOn(texture,'dispose'),disposeGeometry=vi.spyOn(geometry,'dispose'),disposeMaterial=vi.spyOn(material,'dispose');
 const renderer={getPixelRatio:()=>1,render:vi.fn()},preview=flatImagePreview(three,object);
 expect(preview.render(renderer as unknown as three.WebGLRenderer,800,600,{yaw:90,pitch:45,zoom:1}).maxZoom).toBe(3);
 const [scene,camera]=renderer.render.mock.calls[0]! as unknown as [three.Scene,three.Camera],quad=scene.children[0] as three.Mesh;
 expect(camera).toBeInstanceOf(three.OrthographicCamera);expect(quad.material).toBeInstanceOf(three.MeshBasicMaterial);expect(quad.scale.toArray()).toEqual([800,400,1]);expect(quad.rotation.toArray().slice(0,3)).toEqual([0,0,0]);
 const next=new three.Texture({width:4800,height:2400} as unknown as TexImageSource),nextObject=new three.Mesh(geometry,new three.MeshBasicMaterial({map:next}));
 const rollback=preview.replace(nextObject);expect(preview.render(renderer as unknown as three.WebGLRenderer,800,600,{yaw:0,pitch:0,zoom:4}).maxZoom).toBe(6);rollback();expect((quad.material as three.MeshBasicMaterial).map).toBe(texture);
 preview.dispose();expect(disposeTexture).not.toHaveBeenCalled();expect(disposeGeometry).not.toHaveBeenCalled();expect(disposeMaterial).not.toHaveBeenCalled();expect(object.matrixWorld.toArray()).toEqual(before);
});
