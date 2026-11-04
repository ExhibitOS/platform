import {expect,test,vi} from 'vitest';
import * as Three from 'three';
import {newDraft} from './drafts/example';
import {ARTWORK_DETAILS_NAMESPACE,ENTRANCE_NAMESPACE,applyPlaqueCommand,applyRoomPlaqueIntroduction,plaquesFor} from '@exhibitos/studio-contract';
import {installPlaques,plaqueTextureReserve} from './plaque-renderer';
import {plaqueContent,plaqueFaceContent} from './plaque-content';
function fixture(count=5){let d=newDraft().candidate;const room=d.rooms[0]!;room.transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};for(let i=0;i<count;i++)d=applyPlaqueCommand(d,{type:'add-plaque',plaque:{id:crypto.randomUUID(),roomId:room.id,source:{kind:'exhibition'},position:[i*.1,1.5,0],rotation:[0,0,0,1],dimensions:{width:.5,height:.3},visible:true}});const parent=new Three.Group();return {d,parent,rooms:new Map([[room.id.toLowerCase(),parent]])};}
function fakeCanvas(){return {width:0,height:0,getContext:()=>({fillRect:vi.fn(),fillText:vi.fn(),measureText:(s:string)=>({width:Array.from(s).length*12})})} as unknown as HTMLCanvasElement;}
function camera(z:number){const c=new Three.PerspectiveCamera(60,1,.01,100);c.position.set(0,1.5,z);c.lookAt(0,1.5,0);c.updateMatrixWorld();return c;}
test('plaque cap/reserve, no mipmaps, near detail plus persistent far text and teardown bound GPU and CPU resources',()=>{
 const {d,rooms,parent}=fixture(),canvases:HTMLCanvasElement[]=[];const p=installPlaques(Three,d,rooms,true,()=>{const c=fakeCanvas();canvases.push(c);return c;});expect(plaqueTextureReserve(d,true)).toBe(2097152+5*128*64*4*2);p.update(camera(3));expect(p.stats()).toMatchObject({entries:2,bytes:1048576,pinned:2,visible:5,cpuCanvasBytes:1048576+5*128*64*4});
 const texture=p.meshes.find(m=>(m.material.map?.image as {width?:number})?.width===512)!.material.map!;expect(texture.generateMipmaps).toBe(false);const dispose=vi.spyOn(texture,'dispose');
 p.update(camera(4.5));expect(p.stats().active).toHaveLength(2);p.update(camera(6));expect(p.stats().active).toHaveLength(0);expect(p.meshes.every(m=>!!m.material.map)).toBe(true);expect(p.stats().minimumEntries).toBe(5);expect(p.meshes.every(m=>(m.material.map!.image as {width:number}).width===128)).toBe(true);p.dispose();p.dispose();expect(parent.children).toHaveLength(0);expect(dispose).toHaveBeenCalledOnce();expect(canvases.every(c=>c.width===0&&c.height===0)).toBe(true);expect(p.stats().bytes).toBe(0);
});
test('plaque canvas failures degrade only affected labels, keep request IDs and never retry every frame',()=>{
 const {d,rooms}=fixture(1),make=vi.fn(()=>{throw Error('canvas');}),p=installPlaques(Three,d,rooms,false,make);p.update(camera(3));p.update(camera(3));expect(make).toHaveBeenCalledOnce();expect(p.stats().failed).toEqual([plaquesFor(d)[0]!.id]);expect(p.meshes[0]!.userData.plaqueId).toBe(plaquesFor(d)[0]!.id);expect(p.stats().bytes).toBe(0);p.dispose();
});
test('plaque source derives current title/introduction and room name without storing text',()=>{const {d}=fixture(1),p=plaquesFor(d)[0]!;d.title='Changed';expect(plaqueContent(d,p).title).toBe('Changed');expect(plaqueContent(d,{...p,source:{kind:'room'}}).title).toBe(d.rooms[0]!.name);expect(Object.keys(p.source)).toEqual(['kind']);});
test('plaque near front uses inverse-transpose normal under supported nonuniform room scaling',()=>{
 const {d,rooms,parent}=fixture(1),p=plaquesFor(d)[0]!;p.position=[0,1.5,0];p.rotation=[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)];const doc=applyPlaqueCommand(d,{type:'set-plaque',plaque:p});doc.rooms[0]!.transform.scale=[4,1,.25];parent.scale.set(4,1,.25);const runtime=installPlaques(Three,doc,rooms,false,fakeCanvas),c=camera(1);c.position.set(-3,1.5,1);c.lookAt(0,1.5,0);c.updateMatrixWorld();runtime.update(c);expect(runtime.stats().active).toEqual([p.id]);runtime.dispose();
});

test('a physical plaque uses the localized display title and intentional line breaks without truncation or UI copy',()=>{
 const {d,rooms}=fixture(1),plaque=plaquesFor(d)[0]!;
 d.title='Internal working title';
 d.extensions={...d.extensions,[ENTRANCE_NAMESPACE]:{version:1,artist:'Full author text',introduction:'Full reading text stays accessible.',imageAlt:'',mobilePosition:'center',design:{version:1,theme:'catalogue',translations:[{locale:'ko',title:'첫 줄\n둘째 줄'}]}}};
 const draws:Array<{line:string;x:number;y:number;w:number;width:number;height:number}>=[];
 const make=()=>{
  const canvas={width:0,height:0,getContext:()=>context};
  const context={font:'',fillRect:vi.fn(),measureText:(line:string)=>({width:Array.from(line).length*Number(/([.\d]+)px/.exec(context.font)?.[1]??0)}),
   fillText:(line:string,x:number,y:number)=>draws.push({line,x,y,w:context.measureText(line).width,width:canvas.width,height:canvas.height})};
  return canvas as unknown as HTMLCanvasElement;
 };
 const runtime=installPlaques(Three,d,rooms,false,make);
 try{
  runtime.update(camera(3));
  expect(draws.map(({line})=>line)).toEqual(['첫 줄','둘째 줄','첫 줄','둘째 줄']);
  expect(draws.every(({x,y,w,width,height})=>x>0&&y>0&&x+w<width&&y<height)).toBe(true);
  expect(plaqueContent(d,plaque).summary).toContain('Full reading text stays accessible.');
 }finally{runtime.dispose();}
});
test('artwork faces include the authored artist and verified year only when available',()=>{
 const {d}=fixture(1),plaque=plaquesFor(d)[0]!,placementId=crypto.randomUUID(),revisionId=crypto.randomUUID();
 d.placements=[{id:placementId,artworkRevisionId:revisionId} as typeof d.placements[number]];
 const artwork={revisionId,metadata:{title:'Artwork',artist:'Artist'},extensions:{[ARTWORK_DETAILS_NAMESPACE]:{version:1,creationYear:1894}}} as typeof d.artworks[number];
 d.artworks=[artwork];
 const source={...plaque,source:{kind:'artwork' as const,placementId}};
 expect(plaqueFaceContent(d,source)).toEqual({title:'Artwork',summary:'Artist · 1894'});
 delete artwork.extensions?.[ARTWORK_DETAILS_NAMESPACE];
 expect(plaqueFaceContent(d,source)).toEqual({title:'Artwork',summary:'Artist'});
});

test('room faces use the exact localized authored introduction without fallback UI text',()=>{
 const {d}=fixture(1),plaque={...plaquesFor(d)[0]!,source:{kind:'room' as const}};
 expect(plaqueFaceContent(d,plaque)).toEqual({title:d.rooms[0]!.name,summary:''});
 const doc=applyRoomPlaqueIntroduction(d,plaque.roomId,{text:'Default room introduction',translations:[{locale:'KO',text:'공간 소개'}]});
 expect(plaqueFaceContent(doc,plaque)).toEqual({title:d.rooms[0]!.name,summary:'공간 소개'});
});

test('dense valid room copy reflows without losing its introduction on either texture size',()=>{
 const {d,rooms}=fixture(1),plaque={...plaquesFor(d)[0]!,source:{kind:'room' as const}};
 const introduction=Array.from({length:70},(_,i)=>'공간 설명 '+(i+1)).join('\n');
 const doc=applyRoomPlaqueIntroduction(applyPlaqueCommand(d,{type:'set-plaque',plaque}),plaque.roomId,{text:introduction});
 const rows=new Map<number,string[]>();
 const make=()=>{
  const canvas={width:0,height:0,getContext:()=>context};
  const context={font:'',fillRect:vi.fn(),measureText:(line:string)=>({width:Array.from(line).length*Number(/([.\d]+)px/.exec(context.font)?.[1]??0)}),
   fillText:(line:string)=>{const lines=rows.get(canvas.width)??[];lines.push(line);rows.set(canvas.width,lines);}};
  return canvas as unknown as HTMLCanvasElement;
 };
 const runtime=installPlaques(Three,doc,rooms,false,make);
 try{
  runtime.update(camera(3));
  expect([...rows.keys()]).toEqual([128,512]);
  for(const lines of rows.values())expect(lines.join(' ').replace(/\s/g,'')).toBe((doc.rooms[0]!.name+introduction).replace(/\s/g,''));
 }finally{runtime.dispose();}
});
