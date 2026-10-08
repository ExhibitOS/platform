// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {artifactPoint,artifactCorners,artifactBounds,artifactHullHit,artifactSweptCapsuleHit,validateArtifactPose,validateArtworkWalkingProfile,IDENTITY_ARTIFACT_POSE as I,type ArtifactPose} from './artifact-affine.js';
const half=Math.SQRT1_2;
const A:ArtifactPose={position:[1,2,3],rotation:[0,0,half,half],scale:[2,1,1]},P:ArtifactPose={position:[2,1,0],rotation:[0,half,0,half],scale:[1,1,2]},R:ArtifactPose={position:[10,0,0],rotation:[0,0,half,half],scale:[1,1,1]};
const close=(actual:number[],wanted:number[])=>actual.forEach((n,i)=>expect(n).toBeCloseTo(wanted[i]!,10));
test('independent noncommuting artifact-placement-room goldens, centered vertices and annotations',()=>{
 close(artifactPoint([-1,-1,0],A,P,R),[9,8,-2]);close(artifactPoint([0,0,0],A,P,R),[7,8,-1]);close(artifactPoint([.25,.5,0],A,P,R),[6.5,8,-.5]);
 expect(artifactPoint([.25,.5,0],P,A,R)).not.toEqual(artifactPoint([.25,.5,0],A,P,R));
 const corners=artifactCorners({width:2,height:2,depth:1},[A,P,R]);close(artifactBounds(corners).size,[4,2,2]);
});
test('Euclidean capsule distance uses the true sheared assertion hull, not an enclosing OBB',()=>{
 const shear:ArtifactPose={...I,rotation:[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)]},scale:ArtifactPose={...I,scale:[2,1,1]};
 const corners=artifactCorners({width:2,height:2,depth:2},[shear,scale]);
 expect(artifactHullHit(corners,[0,0,-3],[0,0,3],0)).toBe(true);
 expect(artifactHullHit(corners,[2.7,1.3,0],[2.7,1.3,0],.25)).toBe(false); // inside AABB, outside actual slanted edge.
 expect(artifactHullHit(corners,[3.2,0,0],[3.2,0,0],.25)).toBe(false);
 expect(artifactHullHit(corners,[0,1.5,0],[0,1.5,0],.1)).toBe(true);
});
test('round-corner clearance is not the old expanded-box approximation',()=>{
 const corners=artifactCorners({width:2,height:2,depth:2},[I]);
 expect(artifactHullHit(corners,[1.2,1.2,0],[1.2,1.2,0],.25)).toBe(false);
 expect(artifactHullHit(corners,[1.1,1.1,0],[1.1,1.1,0],.25)).toBe(true);
 expect(artifactHullHit(corners,[0,0,-4],[0,0,4],.25)).toBe(true);
});
test('zero rendered depth is retained; collision thickness is an explicit separate proxy',()=>{
 expect(artifactBounds(artifactCorners({width:1,height:1,depth:0},[I])).size[2]).toBe(0);
 expect(artifactBounds(artifactCorners({width:1,height:1,depth:0},[I],true)).size[2]).toBe(.004);
 expect(artifactBounds(artifactCorners({width:1,height:1},[I],true)).size[2]).toBe(.02);
});
test('invalid/mirrored/extreme transforms fail display admission without coercion',()=>{
 for(const scale of [[0,1,1],[-1,1,1],[NaN,1,1],[101,1,1],[1e-8,1,1]])expect(()=>validateArtifactPose({...I,scale:scale as [number,number,number]})).toThrow();
 expect(()=>validateArtifactPose({...I,rotation:[0,0,0,.9]})).toThrow();
 const candidate={artworks:[{revisionId:'a',transform:A,dimensions:{width:2,height:2,depth:1}}],rooms:[{id:'r',transform:R}],placements:[{artworkRevisionId:'a',roomId:'r',transform:P}]};
 expect(validateArtworkWalkingProfile(candidate).valid).toBe(true);candidate.placements[0]!.transform={...P,position:[10000,0,0]};expect(validateArtworkWalkingProfile(candidate).valid).toBe(false);
});
test('admission rejects collapsed compound affine hulls instead of deferring errors to presence/physics',()=>{
 const tiny={...I,scale:[1e-6,1e-6,1e-6] as [number,number,number]};expect(()=>artifactCorners({width:1,height:1,depth:1},[tiny,tiny],true)).toThrow('ARTIFACT_HULL_DEGENERATE');
 const translated={...I,position:[100,0,0] as [number,number,number],scale:[1e-6,1e-6,1e-6] as [number,number,number]};expect(()=>artifactCorners({width:1,height:1,depth:1},[translated],true)).toThrow('ARTIFACT_HULL_DEGENERATE');
});
test('continuous capsule sweep covers thin grazing features between the old vertical sphere samples',()=>{
 const c=artifactCorners({width:.01,height:.001,depth:.01},[{...I,position:[0,.03125,0]}],true);
 // End samples y=0,.0625 would each miss with radius .01; the continuous vertical body crosses the feature.
 expect(artifactHullHit(c,[-1,0,0],[1,0,0],.01)).toBe(false);expect(artifactHullHit(c,[-1,.0625,0],[1,.0625,0],.01)).toBe(false);
 expect(artifactSweptCapsuleHit(c,[-1,0,0],[-1,1.25,0],[1,0,0],[1,1.25,0],.01)).toBe(true);
});

test('continuous swept capsule rejects thin grazing/tunnelling and avoids inflated-sampling false positives',()=>{const c=artifactCorners({width:.01,height:.01,depth:.01},[I],true);expect(artifactSweptCapsuleHit(c,[-1,-.4,.26],[-1,.85,.26],[1,-.4,.26],[1,.85,.26],.25)).toBe(false);expect(artifactSweptCapsuleHit(c,[-1,-.4,.25],[-1,.85,.25],[1,-.4,.25],[1,.85,.25],.25)).toBe(true);expect(artifactSweptCapsuleHit(c,[0,-.4,0],[0,.85,0],[0,-.4,0],[0,.85,0],.25)).toBe(true);});

test('continuous capsule slope/vertical translation preserves equal axis vectors and rejects deformed axes',()=>{const c=artifactCorners({width:.02,height:.02,depth:.02},[{...I,position:[0,.4,0]}],true);expect(artifactSweptCapsuleHit(c,[-1,-.2,0],[-1,1.05,0],[1,.2,0],[1,1.45,0],.25)).toBe(true);expect(artifactSweptCapsuleHit(c,[2,-.2,2],[2,1.05,2],[2,.2,2],[2,1.45,2],.25)).toBe(false);expect(()=>artifactSweptCapsuleHit(c,[-1,0,0],[-1,1,0],[1,0,0],[1,2,0],.25)).toThrow('ARTIFACT_CAPSULE_UNSUPPORTED');});
