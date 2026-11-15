// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {solveTrackSpotAiming as solve,type TrackSpotAimInput,type TrackSpotAimResult,type TrackSpotAimSuccess} from './track-spot-aiming.js';
import type {WasherVector} from './wallwasher-mount-head.js';

// Synthetic caller-supplied envelope qualifies algebra, never source travel,
// collision clearance, catalogue admission, or any real product profile.
function fixture():TrackSpotAimInput{
 return {mountPose:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},
  geometry:{swivelPivot:[0,-.04,0],headPivot:[0,-.15,0],opticalA:[0,-.15,-.0755],forward:[0,0,-1],swivelAxis:[0,1,0],pitchAxis:[1,0,0]},
  envelope:{yawIntervals:[[-Math.PI,Math.PI]],pitchIntervals:[[-Math.PI/2,0]]},
  intent:{kind:'target',point:[2,-2.15,-2]}};
}
function success(r:TrackSpotAimResult):TrackSpotAimSuccess{
 expect(r.reachable).toBe(true);
 if(!r.reachable)throw Error(r.reason);
 return r;
}
function close(a:WasherVector,b:WasherVector){for(let i=0;i<3;i++)expect(a[i]).toBeCloseTo(b[i]!,11);}

test('off-axis target uses the pivot and one shared head/emitter solution without moving the adapter',()=>{
 const input=fixture(),before=structuredClone(input),r=success(solve(input));
 expect(r.yaw).toBeCloseTo(-Math.PI/4,12);
 expect(r.pitch).toBeCloseTo(Math.atan2(-2,Math.sqrt(8)),12);
 const d=1/Math.sqrt(3);close(r.direction,[d,-d,-d]);
 close(r.emitter,[.0755*d,-.15-.0755*d,-.0755*d]);
 expect(r.adapterPose).toEqual(input.mountPose);expect(r.fixedPose).toEqual(r.adapterPose);
 close(r.resolvedTarget!,[2,-2.15,-2]);expect(r.residual).toBeLessThan(1e-12);
 expect(input).toEqual(before);
 const other=success(solve({...input,intent:{kind:'target',point:[-3,-1,-2]}}));
 expect(other.adapterPose).toEqual(r.adapterPose);expect(other.headPose).not.toEqual(r.headPose);
});

test('noncommuting mount rotation/translation produces common-frame sibling poses',()=>{
 const input=fixture(),q=Math.SQRT1_2;
 // W=Rx(pi/2), translation [3,4,5]; local target [2,-2.15,-2].
 input.mountPose={position:[3,4,5],rotation:[q,0,0,q],scale:[1,1,1]};
 input.intent={kind:'target',point:[5,6,2.85]};
 const r=success(solve(input)),d=1/Math.sqrt(3);
 close(r.direction,[d,d,-d]);close(r.emitter,[3+.0755*d,4+.0755*d,5-.15-.0755*d]);
 expect(r.yaw).toBeCloseTo(-Math.PI/4,12);expect(r.residual).toBeLessThan(1e-12);
 expect(r.adapterPose).toEqual(input.mountPose);
 // Yaw about a common Y line leaves the pitch pivot stationary in mount space.
 const [x,y,z,w]=r.headPose.rotation,p:WasherVector=[0,-.15,0];
 const tx=2*(y*p[2]-z*p[1]),ty=2*(z*p[0]-x*p[2]),tz=2*(x*p[1]-y*p[0]);
 close([r.headPose.position[0]+p[0]+w*tx+y*tz-z*ty,r.headPose.position[1]+p[1]+w*ty+z*tx-x*tz,r.headPose.position[2]+p[2]+w*tz+x*ty-y*tx],[3,4,4.85]);
});

test('known manual angles give exact optical outputs and no fabricated target/intersection',()=>{
 const input=fixture();input.intent={kind:'manual',yaw:Math.PI/2,pitch:-Math.PI/6};
 const before=structuredClone(input),r=success(solve(input));
 close(r.direction,[-Math.sqrt(3)/2,-.5,0]);
 close(r.emitter,[-.0755*Math.sqrt(3)/2,-.15-.0755/2,0]);
 expect(r.yaw).toBe(Math.PI/2);expect(r.pitch).toBe(-Math.PI/6);
 expect(r.requestedTarget).toBeNull();expect(r.resolvedTarget).toBeNull();expect(r.residual).toBeNull();
 expect(input).toEqual(before);
});

test('a translated source swivel line uses its explicit pivot instead of the source origin',()=>{
 const input=fixture(),d=1/Math.sqrt(3);
 input.geometry.swivelPivot=[.3,-.04,-.2];input.geometry.headPivot=[.3,-.15,-.2];input.geometry.opticalA=[.3,-.15,-.2755];
 input.intent={kind:'target',point:[2.3,-2.15,-2.2]};
 const r=success(solve(input));close(r.direction,[d,-d,-d]);
 close(r.emitter,[.3+.0755*d,-.15-.0755*d,-.2-.0755*d]);
 expect(r.adapterPose).toEqual(input.mountPose);expect(r.residual).toBeLessThan(1e-12);
});

test('targets inside the aperture distance and at the pivot fail without changing the request',()=>{
 for(const [point,reason]of [
  [[0,-.15,0],'ZERO_TARGET_DIRECTION'],
  [[0,-.15,-.05],'TARGET_AT_OR_BEHIND_APERTURE'],
  [[0,-.15,-.0755],'TARGET_AT_OR_BEHIND_APERTURE'],
 ] as const){
  const input=fixture();input.intent={kind:'target',point};const before=structuredClone(input);
  expect(solve(input)).toMatchObject({reachable:false,reason,requestedTarget:point});expect(input).toEqual(before);
 }
});

test('source limits reject rather than clamp target directions or manual positions',()=>{
 const input=fixture();input.envelope={yawIntervals:[[-.1,.1]],pitchIntervals:[[-.3,0]]};
 expect(solve(input)).toMatchObject({reachable:false,reason:'OUTSIDE_ENVELOPE',requestedTarget:[2,-2.15,-2]});
 input.intent={kind:'manual',yaw:.100000001,pitch:-.2};
 expect(solve(input)).toMatchObject({reachable:false,reason:'OUTSIDE_ENVELOPE',requestedTarget:null});
 input.intent={kind:'manual',yaw:.1,pitch:-.3};expect(success(solve(input)).yaw).toBe(.1);
 input.intent={kind:'manual',yaw:.1+2*Math.PI,pitch:-.3};
 expect(solve(input)).toMatchObject({reachable:false,reason:'OUTSIDE_ENVELOPE'});
});

test('equivalent yaw branches fit source intervals and preserve admissible previous continuity',()=>{
 const input=fixture();input.intent={kind:'target',point:[0,-1,2]};
 input.envelope.yawIntervals=[[Math.PI,Math.PI]];
 const positive=success(solve(input));expect(positive.yaw).toBe(Math.PI);
 input.envelope.yawIntervals=[[-Math.PI,-Math.PI]];
 const negative=success(solve(input));expect(negative.yaw).toBe(-Math.PI);close(negative.direction,positive.direction);
 input.intent={kind:'target',point:[-.001,-1,2]};
 input.envelope.yawIntervals=[[-2*Math.PI,2*Math.PI]];input.previousAngles={yaw:-3.14,pitch:-.4};
 expect(success(solve(input)).yaw).toBeLessThan(-Math.PI);
 // An equivalent target can also use the other Euler branch if explicitly supplied.
 input.intent={kind:'target',point:[0,-1,-2]};input.previousAngles=undefined;
 input.envelope={yawIntervals:[[Math.PI,Math.PI]],pitchIntervals:[[Math.PI,2*Math.PI]]};
 const reflected=success(solve(input));expect(reflected.yaw).toBe(Math.PI);expect(reflected.pitch).toBeGreaterThan(Math.PI);
});

test('vertical pole preserves only an in-envelope previous yaw and never moves the target',()=>{
 const input=fixture();input.intent={kind:'target',point:[0,-3,0]};input.previousAngles={yaw:.7,pitch:-.4};
 const r=success(solve(input));expect(r.yaw).toBe(.7);expect(r.pitch).toBe(-Math.PI/2);close(r.direction,[0,-1,0]);
 input.envelope.yawIntervals=[[1,2]];
 const fallback=success(solve(input));expect(fallback.yaw).toBe(1);expect(fallback.resolvedTarget).toEqual([0,-3,0]);
 input.previousAngles={yaw:1.5,pitch:1};expect(success(solve(input)).yaw).toBe(1);
 // Nearby nonvertical targets still solve their own azimuth, not the previous yaw.
 input.envelope.yawIntervals=[[-Math.PI,Math.PI]];input.previousAngles={yaw:.7,pitch:-.4};
 input.intent={kind:'target',point:[.000001,-3,-.000001]};
 expect(success(solve(input)).yaw).toBeCloseTo(-Math.PI/4,12);
});

test('unsupported geometry is explicit and never treated as generic inverse kinematics',()=>{
 const changes:Array<(v:TrackSpotAimInput)=>void>=[
  v=>{v.geometry.swivelAxis=[0,-1,0];},v=>{v.geometry.pitchAxis=[0,0,1];},
  v=>{v.geometry.forward=[0,0,1];},v=>{v.geometry.headPivot=[.001,-.15,0];},
  v=>{v.geometry.opticalA=[0,-.14,-.0755];},v=>{v.geometry.opticalA=[0,-.15,.0755];},
 ];
 for(const change of changes){const input=fixture();change(input);expect(solve(input)).toMatchObject({reachable:false,reason:'UNSUPPORTED_GEOMETRY'});}
});

test('malformed numeric data, nonrigid mounts and invalid envelopes fail closed',()=>{
 const changes:Array<[(v:TrackSpotAimInput)=>void,string]>=[
  [v=>{v.mountPose.rotation=[0,0,0,1.00001];},'INVALID_MOUNT'],
  [v=>{v.mountPose.scale=[1,2,1];},'INVALID_MOUNT'],
  [v=>{v.mountPose.position=[Infinity,0,0];},'INVALID_MOUNT'],
  [v=>{v.geometry.opticalA=[0,NaN,0];},'INVALID_INPUT'],
  [v=>{v.intent={kind:'target',point:[NaN,0,0]};},'INVALID_INPUT'],
  [v=>{v.intent={kind:'manual',yaw:Infinity,pitch:0};},'INVALID_INPUT'],
  [v=>{v.previousAngles={yaw:NaN,pitch:0};},'INVALID_INPUT'],
  [v=>{v.envelope.yawIntervals=[];},'INVALID_ENVELOPE'],
  [v=>{v.envelope.pitchIntervals=[[0,-1]];},'INVALID_ENVELOPE'],
  [v=>{v.envelope.yawIntervals=[[NaN,1]];},'INVALID_ENVELOPE'],
 ];
 for(const [change,reason]of changes){const input=fixture();change(input);expect(solve(input)).toMatchObject({reachable:false,reason});}
});

test('malformed runtime objects return failures rather than throwing or reshaping invalid targets',()=>{
 for(const input of [null,undefined])expect(solve(input as unknown as TrackSpotAimInput)).toMatchObject({reachable:false,reason:'INVALID_MOUNT',requestedTarget:null});
 const input=fixture();
 for(const previousAngles of [null,[],4,{}])expect(solve({...input,previousAngles} as unknown as TrackSpotAimInput)).toMatchObject({reachable:false,reason:'INVALID_INPUT'});
 for(const point of [[1,2],[1,2,3,4],[1,NaN,3],null])expect(solve({...input,intent:{kind:'target',point}} as unknown as TrackSpotAimInput)).toMatchObject({reachable:false,reason:'INVALID_INPUT',requestedTarget:null});
});
