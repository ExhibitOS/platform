// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {assertArtworkViewpoint,authoredArtworkViewpoint} from './artwork-viewpoint';

it('accepts an image-facing view and rejects the reverse side or a different target',()=>{
 const group=new three.Group();
 group.add(new three.Mesh(new three.PlaneGeometry(2,2),new three.MeshBasicMaterial({map:new three.Texture()})));
 const front={position:[0,0,2] as [number,number,number],target:[0,0,0] as [number,number,number]};
 expect(()=>assertArtworkViewpoint(three,group,'image',front)).not.toThrow();
 expect(()=>assertArtworkViewpoint(three,group,'image',{...front,position:[0,0,-2]})).toThrow('VIEWING_IMAGE_FRONT');
 expect(()=>assertArtworkViewpoint(three,group,'image',{...front,target:[3,0,0]})).toThrow('VIEWING_TARGET_OUTSIDE_ARTWORK');
});

it('uses the actual transformed geometry for a sculpture target',()=>{
 const group=new three.Group(),mesh=new three.Mesh(new three.BoxGeometry(1,1,1),new three.MeshBasicMaterial());
 mesh.position.set(3,0,0);group.add(mesh);
 expect(()=>assertArtworkViewpoint(three,group,'sculpture',{position:[3,1,2],target:[3,0,0]})).not.toThrow();
 expect(()=>assertArtworkViewpoint(three,group,'sculpture',{position:[3,1,2],target:[0,0,0]})).toThrow('VIEWING_TARGET_OUTSIDE_ARTWORK');
});

it('binds an artwork to its authored ordered stop without inventing one for legacy data',()=>{
 const stops=[{placementId:'ABC',viewpointId:'view-a'},{placementId:'def',viewpointId:'view-b'}];
 expect(authoredArtworkViewpoint(stops,'abc')).toBe('view-a');
 expect(authoredArtworkViewpoint(stops,'DEF')).toBe('view-b');
 expect(authoredArtworkViewpoint(stops,'missing')).toBeUndefined();
});
