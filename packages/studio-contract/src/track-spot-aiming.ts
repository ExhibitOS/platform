// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WasherPose,WasherQuaternion,WasherVector} from './wallwasher-mount-head.js';

export type TrackSpotAngles={yaw:number;pitch:number};
export type TrackSpotAimGeometry={
 swivelPivot:WasherVector;headPivot:WasherVector;opticalA:WasherVector;
 forward:WasherVector;swivelAxis:WasherVector;pitchAxis:WasherVector;
};
/** Caller-supplied, verified Cartesian joint envelope, in radians. Supplying
 * intervals does not qualify an asset, its clearance, or its product profile. */
export type TrackSpotAimEnvelope={
 yawIntervals:readonly (readonly [number,number])[];
 pitchIntervals:readonly (readonly [number,number])[];
};
export type TrackSpotAimIntent={kind:'target';point:WasherVector}|({kind:'manual'}&TrackSpotAngles);
export type TrackSpotAimInput={
 mountPose:WasherPose;geometry:TrackSpotAimGeometry;envelope:TrackSpotAimEnvelope;
 intent:TrackSpotAimIntent;previousAngles?:TrackSpotAngles;
};
export type TrackSpotAimFailureReason='INVALID_INPUT'|'INVALID_MOUNT'|'UNSUPPORTED_GEOMETRY'|
 'INVALID_ENVELOPE'|'ZERO_TARGET_DIRECTION'|'TARGET_AT_OR_BEHIND_APERTURE'|
 'OUTSIDE_ENVELOPE'|'NUMERICAL_FAILURE';
export type TrackSpotAimFailure={
 reachable:false;reason:TrackSpotAimFailureReason;remedy:string;requestedTarget:WasherVector|null;
};
export type TrackSpotAimSuccess={
 reachable:true;fixedPose:WasherPose;adapterPose:WasherPose;yokePose:WasherPose;headPose:WasherPose;
 emitter:WasherVector;direction:WasherVector;requestedTarget:WasherVector|null;
 resolvedTarget:WasherVector|null;yaw:number;pitch:number;residual:number|null;
};
export type TrackSpotAimResult=TrackSpotAimSuccess|TrackSpotAimFailure;

// Numerical tolerances only: never mechanical travel or source admission.
const DATUM_EPS=1e-10,QUATERNION_EPS=1e-10,RESIDUAL_EPS=1e-7,TAU=2*Math.PI;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const tuple=(v:unknown,n:number):v is number[]=>Array.isArray(v)&&v.length===n&&v.every(finite);
const add=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:WasherVector,b:WasherVector):WasherVector=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:WasherVector,b:WasherVector)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const copy=(v:WasherVector):WasherVector=>[v[0],v[1],v[2]];
const near=(a:WasherVector,b:WasherVector)=>Math.hypot(...sub(a,b))<=DATUM_EPS;
function rotate(q:WasherQuaternion,v:WasherVector):WasherVector{
 const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
 return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
function multiply(a:WasherQuaternion,b:WasherQuaternion):WasherQuaternion{
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
}
const point=(p:WasherPose,v:WasherVector)=>add(p.position,rotate(p.rotation,v));
const compose=(a:WasherPose,b:WasherPose):WasherPose=>({position:point(a,b.position),rotation:multiply(a.rotation,b.rotation),scale:[1,1,1]});
const around=(pivot:WasherVector,q:WasherQuaternion):WasherPose=>({position:sub(pivot,rotate(q,pivot)),rotation:q,scale:[1,1,1]});
const contains=(intervals:readonly (readonly [number,number])[],n:number)=>intervals.some(([lo,hi])=>n>=lo&&n<=hi);
const validIntervals=(v:unknown):v is readonly (readonly [number,number])[]=>Array.isArray(v)&&v.length>0&&v.every(p=>tuple(p,2)&&p[0]!<=p[1]!);

/** Select an equivalent full-turn representative, not a clamped angle. At
 * most three integer candidates per supplied interval; no travel sampling. */
function representative(base:number,intervals:readonly (readonly [number,number])[],reference:number):number|undefined{
 let best:number|undefined;
 for(const [lo,hi]of intervals){
  const first=Math.ceil((lo-base)/TAU),last=Math.floor((hi-base)/TAU);
  if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>last)continue;
  for(const turn of [first,last,Math.round((reference-base)/TAU)]){
   if(turn<first||turn>last)continue;
   const angle=base+turn*TAU;
   if(angle<lo||angle>hi)continue;
   if(best===undefined||Math.abs(angle-reference)<Math.abs(best-reference))best=angle;
  }
 }
 return best;
}
function freeYaw(intervals:readonly (readonly [number,number])[]):number{
 let best=intervals[0]![0];
 for(const [lo,hi]of intervals){
  const candidate=lo<=0&&hi>=0?0:Math.abs(lo)<=Math.abs(hi)?lo:hi;
  if(Math.abs(candidate)<Math.abs(best))best=candidate;
 }
 return best;
}

/** Pure Y-swivel/X-pitch rigid algebra, in one common frame (ROOM-local for
 * mounted catalogue consumers). No document lookup, source/profile admission,
 * target persistence, generic IK, limit expansion, or target/angle clamping.
 *
 * Requires P on the swivel Y line and A=P+d*(0,0,-1), d>0. Thus the
 * target direction is solved from P, never from the moving aperture.
 * Y=T(S)RyT(-S), H=Y*T(P)RxT(-P); all output poses are common-frame
 * siblings W, W*Y, W*H, not local poses to nest and rotate a second time. */
export function solveTrackSpotAiming(input:TrackSpotAimInput):TrackSpotAimResult{
 // Malformed/nonfinite target values have no valid requestedTarget vector.
 const requestedTarget=input?.intent?.kind==='target'&&tuple(input.intent.point,3)?copy(input.intent.point):null;
 const fail=(reason:TrackSpotAimFailureReason,remedy:string):TrackSpotAimFailure=>({reachable:false,reason,remedy,requestedTarget});
 const mount=input?.mountPose,g=input?.geometry,envelope=input?.envelope,intent=input?.intent;
 if(!mount||!tuple(mount.position,3)||!tuple(mount.rotation,4)||!tuple(mount.scale,3)||mount.scale.some(n=>n!==1))return fail('INVALID_MOUNT','Supply a finite unit-scale rigid mount pose.');
 const norm=Math.hypot(...mount.rotation);
 if(!finite(norm)||Math.abs(norm-1)>QUATERNION_EPS)return fail('INVALID_MOUNT','Supply a unit XYZW mount quaternion.');
 if(!g||![g.swivelPivot,g.headPivot,g.opticalA,g.forward,g.swivelAxis,g.pitchAxis].every(v=>tuple(v,3)))return fail('INVALID_INPUT','Supply finite source geometry datums.');
 const offset=sub(g.opticalA,g.headPivot);
 if(!near(g.forward,[0,0,-1])||!near(g.swivelAxis,[0,1,0])||!near(g.pitchAxis,[1,0,0])||
  Math.abs(g.headPivot[0]-g.swivelPivot[0])>DATUM_EPS||Math.abs(g.headPivot[2]-g.swivelPivot[2])>DATUM_EPS||
  Math.abs(offset[0])>DATUM_EPS||Math.abs(offset[1])>DATUM_EPS||!finite(-offset[2])||-offset[2]<=DATUM_EPS)return fail('UNSUPPORTED_GEOMETRY','Provide certified coaxial Y-swivel/X-pitch geometry with the aperture along the head -Z axis.');
 if(!envelope||!validIntervals(envelope.yawIntervals)||!validIntervals(envelope.pitchIntervals))return fail('INVALID_ENVELOPE','Supply finite ordered verified yaw and pitch intervals.');
 if(!intent||(intent.kind!=='target'&&intent.kind!=='manual')||
  (intent.kind==='target'?!tuple(intent.point,3):!finite(intent.yaw)||!finite(intent.pitch))||
  (input.previousAngles!==undefined&&(!input.previousAngles||!finite(input.previousAngles.yaw)||!finite(input.previousAngles.pitch))))return fail('INVALID_INPUT','Supply a finite target or manual angles and finite previous angles.');
 // Preserve the validated mount, including quaternion components. The bounded
 // unit tolerance admits floating-point roundoff, not a silent pose rewrite.
 const adapterPose:WasherPose={position:copy(mount.position),rotation:[mount.rotation[0],mount.rotation[1],mount.rotation[2],mount.rotation[3]],scale:[1,1,1]};
 const previous=input.previousAngles,previousInside=previous&&contains(envelope.yawIntervals,previous.yaw)&&contains(envelope.pitchIntervals,previous.pitch)?previous:undefined;
 let yaw:number,pitch:number;
 if(intent.kind==='manual'){
  // Manual values are explicit joint positions; do not rewrite by a full turn.
  yaw=intent.yaw;pitch=intent.pitch;
  if(!contains(envelope.yawIntervals,yaw)||!contains(envelope.pitchIntervals,pitch))return fail('OUTSIDE_ENVELOPE','Choose joint angles inside the verified source envelope.');
 }else{
  const inverse:WasherQuaternion=[-adapterPose.rotation[0],-adapterPose.rotation[1],-adapterPose.rotation[2],adapterPose.rotation[3]];
  const delta=sub(rotate(inverse,sub(intent.point,adapterPose.position)),g.headPivot),distance=Math.hypot(...delta);
  if(!delta.every(finite)||!finite(distance))return fail('NUMERICAL_FAILURE','Use coordinates with finite rigid-transform arithmetic.');
  if(distance<=DATUM_EPS)return fail('ZERO_TARGET_DIRECTION','Move the target away from the head pivot.');
  if(distance<=-offset[2]+DATUM_EPS)return fail('TARGET_AT_OR_BEHIND_APERTURE','Move the target beyond the optical aperture.');
  const horizontal=Math.hypot(delta[0],delta[2]),canonicalPitch=Math.atan2(delta[1],horizontal);
  // Only a numerically vertical direction leaves yaw free. Keep an admissible
  // previous yaw at the pole; an out-of-envelope previous state has no authority.
  const pole=horizontal<=Number.EPSILON*8*distance;
  const canonicalYaw=pole?(previousInside?.yaw??freeYaw(envelope.yawIntervals)):Math.atan2(-delta[0],-delta[2]);
  const candidates:TrackSpotAngles[]=[];
  for(const [baseYaw,basePitch]of [[canonicalYaw,canonicalPitch],[canonicalYaw+Math.PI,Math.PI-canonicalPitch]]){
   const y=pole?canonicalYaw:representative(baseYaw!,envelope.yawIntervals,previousInside?.yaw??canonicalYaw);
   const p=representative(basePitch!,envelope.pitchIntervals,previousInside?.pitch??canonicalPitch);
   if(y!==undefined&&p!==undefined)candidates.push({yaw:y,pitch:p});
  }
  if(!candidates.length)return fail('OUTSIDE_ENVELOPE','Move the target or mount so the requested direction fits the verified source envelope.');
  const reference=previousInside??{yaw:canonicalYaw,pitch:canonicalPitch};
  candidates.sort((a,b)=>Math.hypot(a.yaw-reference.yaw,a.pitch-reference.pitch)-Math.hypot(b.yaw-reference.yaw,b.pitch-reference.pitch));
  ({yaw,pitch}=candidates[0]!);
 }
 const ry:WasherQuaternion=[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],rx:WasherQuaternion=[Math.sin(pitch/2),0,0,Math.cos(pitch/2)];
 const yoke=around(g.swivelPivot,ry),head=compose(yoke,around(g.headPivot,rx));
 const yokePose=compose(adapterPose,yoke),headPose=compose(adapterPose,head);
 const emitter=point(headPose,g.opticalA),direction=rotate(headPose.rotation,[0,0,-1]);
 if(![...yokePose.position,...yokePose.rotation,...headPose.position,...headPose.rotation,...emitter,...direction].every(finite))return fail('NUMERICAL_FAILURE','Use coordinates with finite rigid-transform arithmetic.');
 let residual:number|null=null;
 if(intent.kind==='target'){
  const ray=sub(intent.point,emitter),along=dot(ray,direction);
  residual=Math.hypot(...sub(ray,[along*direction[0],along*direction[1],along*direction[2]]));
  if(!finite(along)||!finite(residual)||along<=0||residual>RESIDUAL_EPS)return fail('NUMERICAL_FAILURE','Use source datums and coordinates that resolve the requested target within numerical tolerance.');
 }
 return {reachable:true,fixedPose:adapterPose,adapterPose,yokePose,headPose,emitter,direction,requestedTarget,
  resolvedTarget:intent.kind==='target'?copy(intent.point):null,yaw,pitch,residual};
}
