// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
type Vec = [number, number, number];
function rotate(p:Vec,q:[number,number,number,number]):Vec {const [x,y,z,w]=q,[a,b,c]=p,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
function local(p:Vec,t:Exhibition["rooms"][number]["transform"]):Vec {return rotate(p.map((v,i)=>v-t.position[i]!) as Vec,[-t.rotation[0],-t.rotation[1],-t.rotation[2],t.rotation[3]]);}
/** Straight-line, aperture-aware planar occlusion; not diffraction or measured acoustics.
 * Duplicate coincident room boundaries attenuate once, and curved generated chords are ordinary planes. */
export function occlusionGain(doc:Exhibition,listener:Vec,source:Vec,closedGain:number):number {
 if(![...listener,...source,closedGain].every(Number.isFinite))return 0;
 const hits:number[]=[];
 for(const s of doc.surfaces){const room=doc.rooms.find(r=>r.id.toLowerCase()===s.roomId.toLowerCase());if(!room)continue;
 const a=local(local(listener,room.transform),s.transform),b=local(local(source,room.transform),s.transform),dz=b[2]-a[2];
 if(Math.abs(dz)<1e-8)continue;const t=-a[2]/dz;if(t<=1e-5||t>=1-1e-5)continue;
 const x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]);if(Math.abs(x)>s.dimensions.width/2||Math.abs(y)>s.dimensions.height/2)continue;
 if(doc.openings.some(o=>o.surfaceId.toLowerCase()===s.id.toLowerCase()&&Math.abs(x-o.offset[0])<o.dimensions.width/2&&Math.abs(y-o.offset[1])<o.dimensions.height/2))continue;
 if(!hits.some(h=>Math.abs(h-t)<1e-5))hits.push(t);
 }
 return Math.max(0,Math.min(1,closedGain))**Math.min(hits.length,16);
}
export function authoredDistanceGain(distance:number,reference:number,max:number,rolloff:number):number {
 if(![distance,reference,max,rolloff].every(Number.isFinite)||distance<0||reference<=0||max<reference||rolloff<0)return 0;
 if(distance>=max)return 0;if(distance<=reference)return 1;
 return Math.max(0,Math.min(1,reference/(reference+rolloff*(distance-reference))));
}
