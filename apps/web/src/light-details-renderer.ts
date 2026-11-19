// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {coupleFixtureEmission} from './fixture-emission';
import {furnishingsFor,hasDefaultRoomLighting,lightDetailsFor,lightDetailsOrientation,lightDetailsTarget,resolveTrackSpotAiming,spaceLightingFor,validateStudioLightDetails,type TrackSpotAimingSuccess} from '@exhibitos/studio-contract';

/** Local defaults and contained fills do not select the exhibition-wide fallback. */
export function hasAuthoredGalleryLighting(document: Exhibition): boolean {
  const localLights = new Set(lightDetailsFor(document)
    .filter(details => details.purpose === 'room-base' || details.ceilingFill)
    .map(details => details.lightId.toLowerCase()));
  return document.lights.some(light => !localLights.has(light.id.toLowerCase()));
}

/** Resolve only the synthetic gallery lighting. Saved lights and daylight
 * remain owned by the authored lighting paths. */
export function galleryLightingFor(document: Exhibition) {
  const spaceLighting=spaceLightingFor(document);
  const roomOnly=!spaceLighting&&hasDefaultRoomLighting(document);
  const hasAuthoredLighting=hasAuthoredGalleryLighting(document);
  const fallbackSun=!spaceLighting&&!roomOnly&&!hasAuthoredLighting;
  return {
    spaceLighting,roomOnly,fallbackSun,
    baselineIntensity:spaceLighting?.baselineIntensity??(roomOnly ? 0 : hasAuthoredLighting ? .4 : 2.5),
    environmentBaselineIntensity:spaceLighting?.baselineIntensity??(roomOnly ? 0 : hasAuthoredLighting ? .2 : .6),
    reflectionIntensity:spaceLighting?.reflectionIntensity??(roomOnly ? 0 : .45),
  };
}

type CatalogueLightFixture = 'pending'|'ready'|'invalid'|'budget-unavailable'|'model-failed';
type LightFixtureState = {id:string;light:Three.Light|undefined;defaultArea:boolean;builtIn:boolean;catalogue:CatalogueLightFixture|null};

/** Document luminaires emit only with their own admitted physical visual, or
 * the room's explicit default area light. Visibility here is independent of
 * the camera, artwork selection, and frustum culling. */
export function installLightFixtureGate(
 document: Exhibition,
 lights: ReadonlyMap<string,{light:Three.Light}>,
 builtInFixtures: ReadonlyMap<string,Three.Object3D[]>,
 catalogueHosts: ReadonlySet<string>,
 catalogueReserved: boolean,
){
 const details=new Map(lightDetailsFor(document).map(entry=>[entry.lightId.toLowerCase(),entry]));
 const bindings=furnishingsFor(document)?.bindings;
 const declared=new Set((Array.isArray(bindings)?bindings:[])
   .filter(row=>row?.hostKind==='light'&&typeof row.hostId==='string').map(row=>row.hostId.toLowerCase()));
 const states=new Map<string,LightFixtureState>(document.lights.map(item=>{
  const key=item.id.toLowerCase(),light=lights.get(item.id)?.light;
  const defaultArea=item.type==='area'&&details.get(key)?.purpose==='room-base';
  const builtIn=builtInFixtures.get(key)?.some(group=>!!group.parent&&group.visible)??false;
  const catalogue:CatalogueLightFixture|null=catalogueHosts.has(key)
    ?(catalogueReserved?'pending':'budget-unavailable'):(declared.has(key)?'invalid':null);
  return [key,{id:item.id,light,defaultArea,builtIn,catalogue}] as const;
 }));
 const refresh=(state:LightFixtureState)=>{
  if(state.light)state.light.visible=state.defaultArea||state.builtIn||state.catalogue==='ready';
 };
 for(const state of states.values())refresh(state);
 return {
  settle(id:string,status:'ready'|'model-failed'){
   const state=states.get(id.toLowerCase());
   if(!state||!catalogueHosts.has(id.toLowerCase())||!catalogueReserved)return;
   state.catalogue=status;
   refresh(state);
  },
  records:()=>[...states.values()].map(state=>({
   lightId:state.id,eligible:state.light?.visible??false,
   support:state.defaultArea?'room-base-area':state.catalogue==='ready'?'catalogue':state.builtIn?'built-in':null,
   catalogue:state.catalogue,
   reason:state.light?.visible?null:state.catalogue??'absent',
  })),
 };
}

/** Opt-in bodies are simple non-shadow-casting visual geometry, not an optical model.
 * Stored RGB remains authoritative. No K conversion, new light or shadow is created here.
 */
export function installLightDetails(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,lights:ReadonlyMap<string,{light:Three.Light}>,editing:boolean){
  if(!validateStudioLightDetails(document).valid)throw Error('LIGHT_DETAILS_INVALID');
  // Resolve every active known joint before touching any live light. Both the
  // Viewer and CPU inventory use this same Shared solution in ROOM-local space.
  const articulated=new Map<string,TrackSpotAimingSuccess>();
  for(const entry of lightDetailsFor(document))if(entry.trackAim){
    const result=resolveTrackSpotAiming(document,entry.lightId);
    if(!result.reachable)throw Error('TRACK_SPOT_AIM_'+result.reason);
    const item=document.lights.find(light=>light.id.toLowerCase()===entry.lightId.toLowerCase());
    if(!item||!(lights.get(item.id)?.light instanceof three.SpotLight))throw Error('TRACK_SPOT_AIM_LIGHT_REQUIRED');
    articulated.set(entry.lightId.toLowerCase(),result);
  }
  const fixtures=new Map<string,Three.Object3D[]>(),entries=lightDetailsFor(document),groups:Three.Object3D[]=[],geometries=new Map<string,Three.BufferGeometry>(),materials=new Map<string,Three.Material>(),changes:(()=>void)[]=[];let disposed=false;
  const geometry=(key:string,make:()=>Three.BufferGeometry)=>{let g=geometries.get(key);if(!g){g=make();geometries.set(key,g);}return g;};
  const material=(key:string,make:()=>Three.Material)=>{let m=materials.get(key);if(!m){m=make();materials.set(key,m);}return m;};
  const records:{lightId:string;fixture:string;fixtureMeshes:number;guideCount:number;target:number[]|null;penumbra:number|null;range:number|null;color:number[]}[]=[];
  try{for(const entry of entries){
    const item=document.lights.find(l=>l.id.toLowerCase()===entry.lightId.toLowerCase())!,parent=rooms.get(item.roomId.toLowerCase()),light=lights.get(item.id)?.light;
    if(!parent||!light)throw Error('LIGHT_DETAILS_REFERENCE');
    const oldPosition=light.position.clone(),oldQuaternion=light.quaternion.clone(),oldTarget=light instanceof three.SpotLight||light instanceof three.DirectionalLight?light.target:undefined,oldPenumbra=light instanceof three.SpotLight?light.penumbra:0,oldRange=light instanceof three.SpotLight||light instanceof three.PointLight?light.distance:0;
    changes.push(()=>{light.position.copy(oldPosition);light.quaternion.copy(oldQuaternion);if(light instanceof three.SpotLight){light.penumbra=oldPenumbra;light.distance=oldRange;}else if(light instanceof three.PointLight)light.distance=oldRange;if((light instanceof three.SpotLight||light instanceof three.DirectionalLight)&&oldTarget)light.target=oldTarget;});
    if(light instanceof three.SpotLight&&entry.penumbra!==undefined)light.penumbra=entry.penumbra;
    if((light instanceof three.SpotLight||light instanceof three.PointLight)&&entry.range!==undefined)light.distance=entry.range;
    const resolved=articulated.get(item.id.toLowerCase());
    if(resolved){light.position.fromArray(resolved.emitter);light.quaternion.fromArray(resolved.headPose.rotation);}
    const target=resolved?(resolved.resolvedTarget??resolved.emitter.map((n,i)=>n+resolved.direction[i]!)):entry.aim?lightDetailsTarget(document,item,entry):undefined;
    if(target){
      if(light instanceof three.SpotLight||light instanceof three.DirectionalLight){const aim=new three.Object3D();aim.position.fromArray(target);parent.add(aim);groups.push(aim);light.target=aim;}
      else if(light instanceof three.RectAreaLight)light.quaternion.fromArray(lightDetailsOrientation(document,item,entry));
    }
    let fixtureMeshes=0,guideCount=0;
    if(entry.fixture!=='none'){
      const group=new three.Group();group.position.fromArray(item.transform.position);group.quaternion.fromArray(lightDetailsOrientation(document,item,entry));group.scale.fromArray(item.transform.scale);group.userData.lightId=item.id;parent.add(group);groups.push(group);
      const bodyMaterial=material('body',()=>new three.MeshStandardMaterial({color:'#2d3538',roughness:.8,metalness:.1})),lensMaterial=material('lens:'+item.id,()=>new three.MeshStandardMaterial({color:'#eee8db',roughness:.35,metalness:0})) as Three.MeshStandardMaterial;
      if(entry.fixture==='panel'){
        const body=new three.Mesh(geometry('box',()=>new three.BoxGeometry(1,1,1)),bodyMaterial),lens=new three.Mesh(geometry('plane',()=>new three.PlaneGeometry(1,1)),lensMaterial);
        body.scale.set(item.dimensions!.width,item.dimensions!.height,.03);lens.scale.set(item.dimensions!.width*.9,item.dimensions!.height*.9,1);lens.position.z=-.016;lens.rotation.y=Math.PI;group.add(body,lens);changes.push(coupleFixtureEmission(lens,lensMaterial,light));
      }else{
        const diameter=entry.fixture==='disc'?.18:.12,depth=entry.fixture==='disc'?.04:.2,body=new three.Mesh(geometry('cylinder',()=>new three.CylinderGeometry(.5,.5,1,12)),bodyMaterial),lens=new three.Mesh(geometry('circle',()=>new three.CircleGeometry(.5,12)),lensMaterial);
        body.rotation.x=Math.PI/2;body.scale.set(diameter,depth,diameter);lens.scale.set(diameter*.84,diameter*.84,1);lens.position.z=-depth/2-.001;lens.rotation.y=Math.PI;group.add(body,lens);changes.push(coupleFixtureEmission(lens,lensMaterial,light));
      }
      fixtures.set(item.id.toLowerCase(),[group]);fixtureMeshes=2;for(const object of group.children){object.userData.lightId=item.id;object.userData.exhibitosLightFixture=true;}
    }
    // The public visitor never gets authoring lines or beam handles.
    const aimed=target??(entry.fixture!=='none'?lightDetailsTarget(document,item,entry):undefined);
    if(editing&&aimed){
      const from=resolved?light.position.clone():new three.Vector3(...item.transform.position),to=new three.Vector3(...aimed),direction=to.clone().sub(from),distance=Math.min(direction.length(),entry.range??10,10),points:number[]=[];
      const forward=direction.normalize(),end=from.clone().addScaledVector(forward,distance);points.push(...from.toArray(),...end.toArray());
      if(item.type==='spot'){
        const rotation=new three.Quaternion().fromArray(resolved?.headPose.rotation??lightDetailsOrientation(document,item,entry)),radius=Math.min(10,distance*Math.tan(item.beamAngle!/2));
        for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6,p=new three.Vector3(Math.cos(a)*radius,Math.sin(a)*radius,-distance).applyQuaternion(rotation).add(from),q=new three.Vector3(Math.cos(b)*radius,Math.sin(b)*radius,-distance).applyQuaternion(rotation).add(from);points.push(...p.toArray(),...q.toArray(),...from.toArray(),...p.toArray());}
      }
      const g=new three.BufferGeometry();geometries.set('guide:'+item.id,g);g.setAttribute('position',new three.Float32BufferAttribute(points,3));
      const line=new three.LineSegments(g,material('guide',()=>new three.LineBasicMaterial({color:'#b57826',transparent:true,opacity:.6})));line.userData.sceneSnapshotOverlay=true;parent.add(line);groups.push(line);guideCount=1;
    }
    records.push({lightId:item.id,fixture:entry.fixture,fixtureMeshes,guideCount,target:aimed?[...aimed]:null,penumbra:light instanceof three.SpotLight?light.penumbra:null,range:light instanceof three.SpotLight||light instanceof three.PointLight?light.distance:null,color:light.color.toArray()});
  }}catch(error){for(const restore of changes)restore();for(const g of groups)g.removeFromParent();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();throw error;}
  return {records,fixtures,dispose(){if(disposed)return;disposed=true;for(const restore of changes)restore();changes.length=0;for(const g of groups)g.removeFromParent();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();groups.length=0;fixtures.clear();geometries.clear();materials.clear();}};
}
