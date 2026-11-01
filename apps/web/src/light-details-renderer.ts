// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {lightDetailsFor,lightDetailsOrientation,lightDetailsTarget,validateStudioLightDetails} from '@exhibitos/studio-contract';

/** Opt-in bodies are simple non-shadow-casting visual geometry, not an optical model.
 * Stored RGB remains authoritative. No K conversion, new light or shadow is created here.
 */
export function installLightDetails(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>,lights:ReadonlyMap<string,{light:Three.Light}>,editing:boolean){
  if(!validateStudioLightDetails(document).valid)throw Error('LIGHT_DETAILS_INVALID');
  const fixtures=new Map<string,Three.Object3D[]>(),entries=lightDetailsFor(document),groups:Three.Object3D[]=[],geometries=new Map<string,Three.BufferGeometry>(),materials=new Map<string,Three.Material>(),changes:(()=>void)[]=[];let disposed=false;
  const geometry=(key:string,make:()=>Three.BufferGeometry)=>{let g=geometries.get(key);if(!g){g=make();geometries.set(key,g);}return g;};
  const material=(key:string,make:()=>Three.Material)=>{let m=materials.get(key);if(!m){m=make();materials.set(key,m);}return m;};
  const records:{lightId:string;fixture:string;fixtureMeshes:number;guideCount:number;target:number[]|null;penumbra:number|null;range:number|null;color:number[]}[]=[];
  try{for(const entry of entries){
    const item=document.lights.find(l=>l.id.toLowerCase()===entry.lightId.toLowerCase())!,parent=rooms.get(item.roomId.toLowerCase()),light=lights.get(item.id)?.light;
    if(!parent||!light)throw Error('LIGHT_DETAILS_REFERENCE');
    const oldQuaternion=light.quaternion.clone(),oldTarget=light instanceof three.SpotLight||light instanceof three.DirectionalLight?light.target:undefined,oldPenumbra=light instanceof three.SpotLight?light.penumbra:0,oldRange=light instanceof three.SpotLight||light instanceof three.PointLight?light.distance:0;
    changes.push(()=>{light.quaternion.copy(oldQuaternion);if(light instanceof three.SpotLight){light.penumbra=oldPenumbra;light.distance=oldRange;}else if(light instanceof three.PointLight)light.distance=oldRange;if((light instanceof three.SpotLight||light instanceof three.DirectionalLight)&&oldTarget)light.target=oldTarget;});
    if(light instanceof three.SpotLight&&entry.penumbra!==undefined)light.penumbra=entry.penumbra;
    if((light instanceof three.SpotLight||light instanceof three.PointLight)&&entry.range!==undefined)light.distance=entry.range;
    const target=entry.aim?lightDetailsTarget(document,item,entry):undefined;
    if(target){
      if(light instanceof three.SpotLight||light instanceof three.DirectionalLight){const aim=new three.Object3D();aim.position.fromArray(target);parent.add(aim);groups.push(aim);light.target=aim;}
      else if(light instanceof three.RectAreaLight)light.quaternion.fromArray(lightDetailsOrientation(document,item,entry));
    }
    let fixtureMeshes=0,guideCount=0;
    if(entry.fixture!=='none'){
      const group=new three.Group();group.position.fromArray(item.transform.position);group.quaternion.fromArray(lightDetailsOrientation(document,item,entry));group.scale.fromArray(item.transform.scale);group.userData.lightId=item.id;parent.add(group);groups.push(group);
      const bodyMaterial=material('body',()=>new three.MeshStandardMaterial({color:'#2d3538',roughness:.8,metalness:.1})),lensMaterial=material('lens',()=>new three.MeshStandardMaterial({color:'#eee8db',roughness:.35,metalness:0}));
      if(entry.fixture==='panel'){
        const body=new three.Mesh(geometry('box',()=>new three.BoxGeometry(1,1,1)),bodyMaterial),lens=new three.Mesh(geometry('plane',()=>new three.PlaneGeometry(1,1)),lensMaterial);
        body.scale.set(item.dimensions!.width,item.dimensions!.height,.03);lens.scale.set(item.dimensions!.width*.9,item.dimensions!.height*.9,1);lens.position.z=-.016;lens.rotation.y=Math.PI;group.add(body,lens);
      }else{
        const diameter=entry.fixture==='disc'?.18:.12,depth=entry.fixture==='disc'?.04:.2,body=new three.Mesh(geometry('cylinder',()=>new three.CylinderGeometry(.5,.5,1,12)),bodyMaterial),lens=new three.Mesh(geometry('circle',()=>new three.CircleGeometry(.5,12)),lensMaterial);
        body.rotation.x=Math.PI/2;body.scale.set(diameter,depth,diameter);lens.scale.set(diameter*.84,diameter*.84,1);lens.position.z=-depth/2-.001;lens.rotation.y=Math.PI;group.add(body,lens);
      }
      fixtures.set(item.id.toLowerCase(),[group]);fixtureMeshes=2;for(const object of group.children){object.userData.lightId=item.id;object.userData.exhibitosLightFixture=true;}
    }
    // The public visitor never gets authoring lines or beam handles.
    const aimed=target??(entry.fixture!=='none'?lightDetailsTarget(document,item,entry):undefined);
    if(editing&&aimed){
      const from=new three.Vector3(...item.transform.position),to=new three.Vector3(...aimed),direction=to.clone().sub(from),distance=Math.min(direction.length(),entry.range??10,10),points:number[]=[];
      const forward=direction.normalize(),end=from.clone().addScaledVector(forward,distance);points.push(...from.toArray(),...end.toArray());
      if(item.type==='spot'){
        const rotation=new three.Quaternion().fromArray(lightDetailsOrientation(document,item,entry)),radius=Math.min(10,distance*Math.tan(item.beamAngle!/2));
        for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6,p=new three.Vector3(Math.cos(a)*radius,Math.sin(a)*radius,-distance).applyQuaternion(rotation).add(from),q=new three.Vector3(Math.cos(b)*radius,Math.sin(b)*radius,-distance).applyQuaternion(rotation).add(from);points.push(...p.toArray(),...q.toArray(),...from.toArray(),...p.toArray());}
      }
      const g=new three.BufferGeometry();geometries.set('guide:'+item.id,g);g.setAttribute('position',new three.Float32BufferAttribute(points,3));
      const line=new three.LineSegments(g,material('guide',()=>new three.LineBasicMaterial({color:'#b57826',transparent:true,opacity:.6})));parent.add(line);groups.push(line);guideCount=1;
    }
    records.push({lightId:item.id,fixture:entry.fixture,fixtureMeshes,guideCount,target:aimed??null,penumbra:light instanceof three.SpotLight?light.penumbra:null,range:light instanceof three.SpotLight||light instanceof three.PointLight?light.distance:null,color:light.color.toArray()});
  }}catch(error){for(const restore of changes)restore();for(const g of groups)g.removeFromParent();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();throw error;}
  return {records,fixtures,dispose(){if(disposed)return;disposed=true;for(const restore of changes)restore();changes.length=0;for(const g of groups)g.removeFromParent();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();groups.length=0;fixtures.clear();geometries.clear();materials.clear();}};
}
