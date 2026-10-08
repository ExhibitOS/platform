// SPDX-License-Identifier: AGPL-3.0-or-later
/** Centered-artwork-local metre display profile. No dimension fitting or source-unit conversion. */
export type AffinePoint = [number, number, number];
export interface ArtifactPose { position: AffinePoint; rotation: [number,number,number,number]; scale: AffinePoint }
export const IDENTITY_ARTIFACT_POSE:ArtifactPose={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
export function validateArtifactPose(p:ArtifactPose){
 if(!p||!Array.isArray(p.position)||p.position.length!==3||!Array.isArray(p.rotation)||p.rotation.length!==4||!Array.isArray(p.scale)||p.scale.length!==3||![...p.position,...p.rotation,...p.scale].every(Number.isFinite)||p.position.some(n=>Math.abs(n)>10000)||p.scale.some(n=>n<1e-6||n>100)||Math.abs(Math.hypot(...p.rotation)-1)>1e-6)throw Error('ARTIFACT_AFFINE_UNSUPPORTED');
}
export function artifactPoint(p:AffinePoint,...poses:ArtifactPose[]):AffinePoint{
 if(poses.length>3||p.length!==3||!p.every(Number.isFinite))throw Error('ARTIFACT_AFFINE_UNSUPPORTED');
 let v:AffinePoint=[...p];for(const pose of poses){validateArtifactPose(pose);const [x,y,z,w]=pose.rotation,[a,b,c]=v.map((n,i)=>n*pose.scale[i]!),tx=2*(y*c!-z*b!),ty=2*(z*a!-x*c!),tz=2*(x*b!-y*a!);v=[a!+w*tx+y*tz-z*ty+pose.position[0],b!+w*ty+z*tx-x*tz+pose.position[1],c!+w*tz+x*ty-y*tx+pose.position[2]];}
 if(v.some(n=>!Number.isFinite(n)||Math.abs(n)>10000))throw Error('ARTIFACT_AFFINE_UNSUPPORTED');return v;
}
export function artifactCorners(dimensions:{width:number;height:number;depth?:number},poses:ArtifactPose[],collision=false):AffinePoint[]{
 if(dimensions.depth!==undefined&&(!Number.isFinite(dimensions.depth)||dimensions.depth<0))throw Error('ARTIFACT_AFFINE_UNSUPPORTED');
 const half:AffinePoint=[dimensions.width/2,dimensions.height/2,collision?Math.max(.002,(dimensions.depth??.02)/2):(dimensions.depth??0)/2];
 if(half.some((n,i)=>!Number.isFinite(n)||n<0||n>5000||(i<2&&n===0)))throw Error('ARTIFACT_AFFINE_UNSUPPORTED');
 const corners=Array.from({length:8},(_,i)=>artifactPoint(half.map((n,j)=>n*((i>>j)&1?1:-1)) as AffinePoint,...poses));if(collision)validateArtifactHull(corners);return corners;
}
export function artifactBounds(points:AffinePoint[]){
 if(!points.length||points.length>64||points.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)))throw Error('ARTIFACT_AFFINE_UNSUPPORTED');
 const min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]!))) as AffinePoint,max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i]!))) as AffinePoint;
 return {min,max,size:max.map((n,i)=>n-min[i]!) as AffinePoint,center:max.map((n,i)=>(n+min[i]!)/2) as AffinePoint};
}
const sub=(a:AffinePoint,b:AffinePoint):AffinePoint=>a.map((n,i)=>n-b[i]!) as AffinePoint;
const dot=(a:AffinePoint,b:AffinePoint)=>a.reduce((s,n,i)=>s+n*b[i]!,0);
const cross=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const at=(a:AffinePoint,d:AffinePoint,t:number):AffinePoint=>a.map((n,i)=>n+d[i]!*t) as AffinePoint;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const faces=[[0,2,6,4],[1,5,7,3],[0,4,5,1],[2,3,7,6],[0,1,3,2],[4,6,7,5]];
export function validateArtifactHull(corners:AffinePoint[]){
 if(corners.length!==8)throw Error('ARTIFACT_HULL_UNSUPPORTED');artifactBounds(corners);
 for(const points of [corners,corners.map(p=>p.map(Math.fround) as AffinePoint)]){
  const volume=Math.abs(dot(sub(points[1]!,points[0]!),cross(sub(points[2]!,points[0]!),sub(points[4]!,points[0]!))));if(!(volume>1e-18))throw Error('ARTIFACT_HULL_DEGENERATE');
  for(const f of faces){const p=points[f[0]!]!,n=cross(sub(points[f[1]!]!,p),sub(points[f[2]!]!,p));if(!(Math.hypot(...n)>1e-12))throw Error('ARTIFACT_HULL_DEGENERATE');}
 }
}
function pointTriangle(p:AffinePoint,a:AffinePoint,b:AffinePoint,c:AffinePoint){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return dot(ap,ap);
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return dot(bp,bp);
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const r=sub(p,at(a,ab,d1/(d1-d3)));return dot(r,r);}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return dot(cp,cp);
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const r=sub(p,at(a,ac,d2/(d2-d6)));return dot(r,r);}
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const r=sub(p,at(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));return dot(r,r);}
 const den=va+vb+vc;if(!(den>0))throw Error('ARTIFACT_HULL_DEGENERATE');const r=sub(p,at(at(a,ab,vb/den),ac,vc/den));return dot(r,r);
}
function segments(a:AffinePoint,b:AffinePoint,c:AffinePoint,d:AffinePoint){
 const u=sub(b,a),v=sub(d,c),r=sub(a,c),aa=dot(u,u),ee=dot(v,v),f=dot(v,r);let s=0,t=0;
 if(aa<=1e-24&&ee<=1e-24)return dot(r,r);
 if(aa<=1e-24)t=clamp(f/ee);else{const cc=dot(u,r);if(ee<=1e-24)s=clamp(-cc/aa);else{const bb=dot(u,v),den=aa*ee-bb*bb;s=den>0?clamp((bb*f-cc*ee)/den):0;t=(bb*s+f)/ee;if(t<0){t=0;s=clamp(-cc/aa);}else if(t>1){t=1;s=clamp((bb-cc)/aa);}}}
 const delta=sub(at(a,u,s),at(c,v,t));return dot(delta,delta);
}
/** Euclidean world-space capsule segment versus the actual affine parallelepiped, including shear. */
export function artifactHullHit(corners:AffinePoint[],a:AffinePoint,b:AffinePoint,radius:number){
 if(corners.length!==8||!Number.isFinite(radius)||radius<0||radius>10)throw Error('ARTIFACT_HULL_UNSUPPORTED');validateArtifactHull(corners);artifactBounds([...corners,a,b]);
 // Every rounded convex point is within max vertex displacement of the double hull (convex combinations).
 radius+=1e-7+Math.max(...corners.map(p=>Math.hypot(...p.map(n=>Math.fround(n)-n))));
 const center=artifactBounds(corners).center,direction=sub(b,a);let lo=0,hi=1,best=Infinity;
 for(const face of faces){const p=corners[face[0]!]!,q=corners[face[1]!]!,r=corners[face[2]!]!,normal=cross(sub(q,p),sub(r,p)),length=Math.hypot(...normal);if(!(length>1e-12))throw Error('ARTIFACT_HULL_DEGENERATE');
  const sign=dot(normal,sub(center,p))>0?-1:1,n=normal.map(v=>sign*v/length) as AffinePoint,offset=dot(n,sub(a,p)),slope=dot(n,direction);
  if(Math.abs(slope)<1e-15){if(offset>0){lo=Infinity;}}else{const t=-offset/slope;if(slope<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}
  for(const tri of [[face[0]!,face[1]!,face[2]!],[face[0]!,face[2]!,face[3]!]]){const [x,y,z]=tri.map(i=>corners[i]!) as [AffinePoint,AffinePoint,AffinePoint];best=Math.min(best,pointTriangle(a,x,y,z),pointTriangle(b,x,y,z),segments(a,b,x,y),segments(a,b,y,z),segments(a,b,z,x));}
 }
 // Segment intersecting a face interior is detected by the convex slab interval; endpoints/edges cover separated cases.
 return lo<=hi&&hi>=0&&lo<=1||best<=radius*radius;
}
/** Walking-profile admission validates the same finite assertion proxy chain before navigation/presence creation. */
export function validateArtworkWalkingProfile(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];const issue=(path:string)=>errors.push({code:'ARTIFACT_AFFINE_UNSUPPORTED',path,message:'Artwork/placement/room must fit the bounded centered-metre affine display and collision profile'});
 if(!candidate||typeof candidate!=='object')return {valid:true,errors};const c=candidate as {artworks?:unknown[];placements?:unknown[];rooms?:unknown[]};
 const objects=(v:unknown[]|undefined)=>Array.isArray(v)?v.filter((n):n is Record<string,unknown>=>!!n&&typeof n==='object'):[];
 const arts=objects(c.artworks),rooms=objects(c.rooms),placements=objects(c.placements);
 if(arts.length>4096||rooms.length>32||placements.length>128||(Array.isArray((candidate as {surfaces?:unknown[]}).surfaces)&&(candidate as {surfaces:unknown[]}).surfaces.length>256)||(Array.isArray((candidate as {openings?:unknown[]}).openings)&&(candidate as {openings:unknown[]}).openings.length>128)){issue('/candidate');return {valid:false,errors};}
 for(const [i,a] of arts.entries())try{validateArtifactPose(a.transform as ArtifactPose);}catch{issue('/candidate/artworks/'+i+'/transform');}
 for(const [i,p] of placements.entries())try{const a=arts.find(a=>typeof a.revisionId==='string'&&a.revisionId.toLowerCase()===String(p.artworkRevisionId).toLowerCase()),r=rooms.find(r=>typeof r.id==='string'&&r.id.toLowerCase()===String(p.roomId).toLowerCase());if(!a||!r)throw Error('REFERENCE');artifactCorners(a.dimensions as {width:number;height:number;depth?:number},[a.transform,p.transform,r.transform] as ArtifactPose[],true);}catch{issue('/candidate/placements/'+i);}
 return {valid:errors.length===0,errors};
}

function segmentTriangle(a:AffinePoint,b:AffinePoint,x:AffinePoint,y:AffinePoint,z:AffinePoint){
 const n=cross(sub(y,x),sub(z,x)),da=dot(n,sub(a,x)),db=dot(n,sub(b,x));if(da*db>0||Math.abs(da-db)<1e-24)return false;const hit=at(a,sub(b,a),da/(da-db)),u=sub(y,x),v=sub(z,x),w=sub(hit,x),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),den=aa*cc-bb*bb;if(!(den>0))return false;const t=(cc*dot(w,u)-bb*dot(w,v))/den,q=(aa*dot(w,v)-bb*dot(w,u))/den;return t>=0&&q>=0&&t+q<=1;
}
function triangleDistance(a:AffinePoint[],b:AffinePoint[]){
 const aa=a as [AffinePoint,AffinePoint,AffinePoint],bb=b as [AffinePoint,AffinePoint,AffinePoint];let best=Infinity;
 for(let i=0;i<3;i++){best=Math.min(best,pointTriangle(aa[i]!,...bb),pointTriangle(bb[i]!,...aa));if(segmentTriangle(aa[i]!,aa[(i+1)%3]!,...bb)||segmentTriangle(bb[i]!,bb[(i+1)%3]!,...aa))return 0;for(let j=0;j<3;j++)best=Math.min(best,segments(aa[i]!,aa[(i+1)%3]!,bb[j]!,bb[(j+1)%3]!));}
 return best;
}
/** Continuous Euclidean swept vertical capsule: its axis sweeps a quad, expanded by world radius. */
export function artifactSweptCapsuleHit(corners:AffinePoint[],oldFoot:AffinePoint,oldHead:AffinePoint,newFoot:AffinePoint,newHead:AffinePoint,radius:number){
 validateArtifactHull(corners);artifactBounds([...corners,oldFoot,oldHead,newFoot,newHead]);
 if(!Number.isFinite(radius)||radius<0||radius>1||Math.hypot(...sub(sub(oldHead,oldFoot),sub(newHead,newFoot)))>1e-7)throw Error('ARTIFACT_CAPSULE_UNSUPPORTED');
 // Boundary segments also establish containment and handle stationary/collinear degenerate swept quads.
 const quad=[oldFoot,newFoot,newHead,oldHead];for(let i=0;i<4;i++)if(artifactHullHit(corners,quad[i]!,quad[(i+1)%4]!,radius))return true;
 const expanded=radius+1e-7+Math.max(...corners.map(p=>Math.hypot(...p.map(n=>Math.fround(n)-n))));
 for(const indices of [[0,1,2],[0,2,3]]){const tri=indices.map(i=>quad[i]!);if(Math.hypot(...cross(sub(tri[1]!,tri[0]!),sub(tri[2]!,tri[0]!)))<=1e-12)continue;for(const face of faces)for(const f of [[face[0]!,face[1]!,face[2]!],[face[0]!,face[2]!,face[3]!]])if(triangleDistance(tri,f.map(i=>corners[i]!))<=expanded*expanded)return true;}
 return false;
}
