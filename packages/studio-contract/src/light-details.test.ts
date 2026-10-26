// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {LIGHT_DETAILS_NAMESPACE as N,lightDetailsFor,lightDetailsTarget,lightDetailsOrientation,lightKelvinHex,lightKelvinLinear,remapStudioLightDetails,setLightDetails,validateStudioLightDetails} from './light-details.js';
import type {ExhibitionLight,LightDetails,StudioLightDetails} from './light-details.js';
const room='aaaaaaaa-0000-4000-8000-000000000001',id='aaaaaaaa-0000-4000-8000-000000000002',placement='aaaaaaaa-0000-4000-8000-000000000003',art='aaaaaaaa-0000-4000-8000-000000000004';
const pose=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
const light=():ExhibitionLight=>({id,roomId:room,type:'spot',transform:{...pose(),position:[0,3,1]},color:lightKelvinLinear(4000),intensity:80,unit:'candela',castsShadow:false,beamAngle:Math.PI/4,targetPlacementId:placement});
const details=():LightDetails=>({lightId:id,fixture:'spot-can',aim:{kind:'placement-center'},penumbra:.3,range:8,temperatureKelvin:4000});
function fixture():Exhibition{return {rooms:[{id:room,dimensions:{width:10,height:4,depth:10},transform:pose()}],lights:[light()],placements:[{id:placement,roomId:room,artworkRevisionId:art,transform:{...pose(),position:[0,1,0]}}],artworks:[{revisionId:art,dimensions:{width:2,height:1,depth:0},transform:{...pose(),position:[.2,.3,0]}}],extensions:{'org.example/opaque':{text:id},[N]:{version:1,lights:[details()]}}} as unknown as Exhibition;}
test('legacy absence and explicit K intent preserve RGB and source; bounded approximation has explicit linear conversion',()=>{
  const d=fixture(),before=structuredClone(d);expect(validateStudioLightDetails(d).valid).toBe(true);expect(d).toEqual(before);expect(lightKelvinHex(4000)).toMatch(/^#[0-9a-f]{6}$/);expect(lightKelvinLinear(4000)[1]).toBeLessThan(parseInt(lightKelvinHex(4000).slice(3,5),16)/255);
  delete d.extensions![N];expect(validateStudioLightDetails(d).valid).toBe(true);expect(lightDetailsFor(d)).toEqual([]);expect(()=>lightKelvinHex(999)).toThrow();
});
test('linked aim uses artwork assertion centre through both transforms, follows motion and rejects dangling target',()=>{
  const d=fixture(),l=d.lights[0]!,b=details();expect(lightDetailsTarget(d,l,b)![0]).toBeCloseTo(.2,12);expect(lightDetailsTarget(d,l,b)![1]).toBeCloseTo(1.3,12);d.placements[0]!.transform.position[0]=1;expect(lightDetailsTarget(d,l,b)![0]).toBeCloseTo(1.2,12);expect(lightDetailsTarget(d,l,b)![1]).toBeCloseTo(1.3,12);expect(Math.hypot(...lightDetailsOrientation(d,l,b))).toBeCloseTo(1,10);
  d.placements=[];expect(validateStudioLightDetails(d).valid).toBe(false);
});
test('closed settings reject coercion, unsupported fixture/type, invalid K/RGB, references, bounds and budgets',()=>{
  for(const edit of [(b:Record<string,unknown>)=>b.fixture=['spot-can'],b=>b.extra=true,b=>b.fixture='panel',b=>b.lightId=room,b=>b.penumbra=NaN,b=>b.range=0,b=>b.temperatureKelvin='4000',b=>b.temperatureKelvin=6500,b=>b.aim={kind:'point',position:[0,1,0]},b=>b.aim={kind:'rotation',url:'https://x'}]){const d=fixture();edit((d.extensions![N] as unknown as StudioLightDetails).lights[0] as unknown as Record<string,unknown>);expect(validateStudioLightDetails(d).valid).toBe(false);}
  const world=fixture();world.rooms[0]!.transform.position=[10000,0,0];expect(validateStudioLightDetails(world).valid).toBe(false);
  const many=fixture();(many.extensions![N] as unknown as StudioLightDetails).lights=Array.from({length:33},details);expect(validateStudioLightDetails(many).errors[0]!.code).toBe('LIGHT_DETAILS_LIMIT');
});
test('new atomic direct RGB change clears K without touching source/opaque data; immutable fields and unit conversion remain fenced',()=>{
  const d=fixture(),before=structuredClone(d),{id:_,...l}=d.lights[0]!,{lightId:__,temperatureKelvin:___,...settings}=details();void _;void __;void ___;
  const next=setLightDetails(d,id,{...l,color:[.2,.3,.4]},settings);expect(lightDetailsFor(next)[0]!.temperatureKelvin).toBeUndefined();expect(next.lights[0]!.color).toEqual([.2,.3,.4]);expect(next.extensions!['org.example/opaque']).toEqual(d.extensions!['org.example/opaque']);expect(d).toEqual(before);
  for(const change of [{roomId:art},{castsShadow:true},{unit:'lux' as const}])expect(()=>setLightDetails(d,id,{...l,...change},settings)).toThrow('LIGHT_DETAILS_FIELDS_CHANGED');
});
test('typed light reference remap never changes UUID-shaped prose or target point coordinates',()=>{
  const value={version:1,lights:[{lightId:id,fixture:'none',aim:{kind:'point',position:[0,1,0]}}]} as StudioLightDetails,before=structuredClone(value),next=remapStudioLightDetails(value,new Map([[id,room]]));expect(next.lights[0]).toEqual({...value.lights[0],lightId:room});expect(value).toEqual(before);expect(()=>remapStudioLightDetails(value,new Map())).toThrow('LIGHT_DETAILS_REFERENCE');
});
