// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {INSTALLATION_NAMESPACE as N,validateStudioInstallation,installationBudget,remapStudioInstallation} from './installation.js';
import type {InstallationBinding,InstallationFrame,InstallationMaterial} from './installation.js';
import {resolveInstallations,installationPlane} from './installation-resolver.js';
import {artifactBounds,validateArtifactHull} from './artifact-affine.js';
const id='aaaaaaaa-0000-4000-8000-000000000001',revision='aaaaaaaa-0000-4000-8000-000000000002';
const material:InstallationMaterial={preset:'paint',color:'#FFFFFF',roughness:0,metalness:0};
const pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
const frame=(kind:'flat'|'stepped'|'floating'='flat'):InstallationFrame=>({kind,borderWidth:.1,thickness:.02,depth:.03,gap:kind==='floating'?.02:0,matWidth:.04,matColor:'#EEEEEE',material:{...material,preset:'paint'}});
const binding=():InstallationBinding=>({placementId:id,pedestal:{kind:'box',position:[2,0,3],yaw:0,dimensions:{width:1,depth:2,height:.8},material:{...material}},frame:frame()});
function document(bindings:InstallationBinding[]=[binding()]):Exhibition{return {rooms:[{id:revision,dimensions:{width:20,height:10,depth:20},transform:pose()}],artworks:[{artworkType:'image',revisionId:revision,dimensions:{width:2,height:1,depth:.02},transform:pose()}],placements:[{id,roomId:revision,artworkRevisionId:revision,transform:pose()}],extensions:{[N]:{version:1,placements:bindings}}} as unknown as Exhibition;}
test('legacy absence and explicit none project no decoration without mutating source',()=>{
 const d=document();delete d.extensions;expect(validateStudioInstallation(d).valid).toBe(true);expect(resolveInstallations(d)).toEqual([]);
 const none=document([{placementId:id,pedestal:{kind:'none'},frame:{kind:'none'}}]),before=JSON.stringify(none);expect(resolveInstallations(none)[0]!.primitives).toEqual([]);expect(JSON.stringify(none)).toBe(before);
});
test('strict admission preserves zero factors and rejects unknown keys, scalars and invalid references',()=>{
 expect(validateStudioInstallation(document()).valid).toBe(true);
 for(const edit of [(b:Record<string,unknown>)=>b.unknown=0,b=>b.placementId=revision,b=>b.placementId=3,b=>b.frame={...frame(),gap:.1},b=>b.frame={...frame(),depth:NaN},b=>b.frame={...frame(),material:{...material,preset:'stone'}},b=>b.pedestal={kind:'none',position:[0,0,0]}]){const d=document();edit((d.extensions![N] as {placements:Record<string,unknown>[]}).placements[0]!);expect(validateStudioInstallation(d).valid).toBe(false);}
 expect(validateStudioInstallation(document([binding(),{...binding(),placementId:id.toUpperCase()}])).valid).toBe(false);
});
test('allocation preflight counts mat materials and rejects excessive distinct material pool before geometry',()=>{
 const bindings=Array.from({length:128},(_,i)=>{const b=binding();b.placementId=`aaaaaaaa-0000-4000-8000-${String(i).padStart(12,'0')}`;const color=(n:number)=>'#'+n.toString(16).padStart(6,'0');if(b.pedestal?.kind==='box')b.pedestal.material.color=color(i);if(b.frame?.kind==='flat'){b.frame.material.color=color(128+i);b.frame.matColor=color(256+i);}return b;});
 expect(()=>installationBudget(bindings)).toThrow('INSTALLATION_LIMIT');
 expect(installationBudget([binding()])).toEqual({bindings:1,materials:2,primitives:9,triangles:68});
});
test('typed remap is case insensitive, destination casing retained, unknown/duplicate mappings reject',()=>{
 const dest='bbbbbbbb-0000-4000-8000-000000000001',v={version:1 as const,placements:[binding()]},original=JSON.stringify(v);
 expect(remapStudioInstallation(v,new Map([[id.toUpperCase(),dest.toUpperCase()]])).placements[0]!.placementId).toBe(dest.toUpperCase());expect(JSON.stringify(v)).toBe(original);
 expect(()=>remapStudioInstallation(v,new Map())).toThrow('INSTALLATION_REFERENCE');expect(()=>remapStudioInstallation(v,new Map([[id,dest],[id.toUpperCase(),dest]]))).toThrow('INSTALLATION_REFERENCE');
});
test('pedestal base center and yaw produce metre bounds independent of artwork scale',()=>{
 const d=document(),b=(d.extensions![N] as {placements:InstallationBinding[]}).placements[0]!;b.frame={kind:'none'};
 d.placements[0]!.transform.scale=[2,3,4];const result=resolveInstallations(d)[0]!;expect(result.issues).toEqual([]);expect(artifactBounds(result.primitives[0]!.vertices)).toEqual({min:[1.5,0,2],max:[2.5,.8,4],center:[2,.4,3],size:[1,.8,2]});
 if(b.pedestal?.kind==='box')b.pedestal.yaw=Math.PI/2;const size=artifactBounds(resolveInstallations(d)[0]!.primitives[0]!.vertices).size;expect(size[0]).toBeCloseTo(2);expect(size[2]).toBeCloseTo(1);
 if(b.pedestal?.kind==='box')b.pedestal.position=[10000,0,0];expect(resolveInstallations(d)[0]!.issues).toEqual([{component:'pedestal',reason:'limits-exceeded'}]);
});
test('affine sheared frame preserves exact perpendicular metric border width and nondegenerate hulls',()=>{
 const d=document(),b=(d.extensions![N] as {placements:InstallationBinding[]}).placements[0]!;b.pedestal={kind:'none'};b.frame=frame('floating');
 d.artworks[0]!.transform.rotation=[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)];d.placements[0]!.transform.scale=[2,1,1];const before=JSON.stringify(d),resolved=resolveInstallations(d)[0]!,plane=installationPlane(d.artworks[0]!,d.placements[0]!);
 expect(resolved.issues).toEqual([]);expect(resolved.primitives).toHaveLength(8);
 for(let i=0;i<4;i++){const p=resolved.primitives[i]!,a=plane.corners[i]!,c=plane.corners[(i+1)%4]!,edge=c.map((n,j)=>n-a[j]!),length=Math.hypot(...edge);for(const [vertex,expected] of [[p.vertices[0]!,.06],[p.vertices[1]!, .16]] as const){const delta=vertex.map((n,j)=>n-a[j]!);expect(Math.abs((edge[0]!*delta[1]!-edge[1]!*delta[0]!)/length)).toBeCloseTo(expected,10);}expect(()=>validateArtifactHull(p.vertices)).not.toThrow();}
 expect(JSON.stringify(d)).toBe(before);
});
test('stepped depth zero omits front solids; nonplanar art retains config with explicit limitation',()=>{
 const d=document(),b=(d.extensions![N] as {placements:InstallationBinding[]}).placements[0]!;b.pedestal={kind:'none'};b.frame={...frame('stepped'),depth:0};const result=resolveInstallations(d)[0]!;expect(result.primitives.filter(p=>p.kind==='solid')).toHaveLength(4);expect(result.primitives.filter(p=>p.kind==='mat')).toHaveLength(4);
 d.artworks[0]!.artworkType='sculpture';const before=JSON.stringify(d),unsupported=resolveInstallations(d)[0]!;expect(unsupported.primitives).toEqual([]);expect(unsupported.issues).toEqual([{component:'frame',reason:'source-not-planar'}]);expect(JSON.stringify(d)).toBe(before);
});
test('solid prism and cylinder triangle winding faces outwards with bounded indices',()=>{
 for(const cylinder of [false,true]){const d=document(),b=(d.extensions![N] as {placements:InstallationBinding[]}).placements[0]!;b.frame={kind:'none'};if(cylinder)b.pedestal={kind:'cylinder',position:[0,0,0],yaw:.4,dimensions:{diameter:1,height:.8},material};const p=resolveInstallations(d)[0]!.primitives[0]!,center=artifactBounds(p.vertices).center;expect(p.indices.length/3).toBeLessThanOrEqual(128);for(let i=0;i<p.indices.length;i+=3){const [a,b,c]=p.indices.slice(i,i+3).map(k=>p.vertices[k]!);const u=b!.map((n,k)=>n-a![k]!),v=c!.map((n,k)=>n-a![k]!),n=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];expect(n.reduce((s,x,k)=>s+x*(a![k]!-center[k]!),0)).toBeGreaterThan(0);}}
});
