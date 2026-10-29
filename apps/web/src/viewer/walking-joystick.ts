// SPDX-License-Identifier: AGPL-3.0-or-later
export interface JoystickActions {
 resumeInput?:()=>boolean;
 move:(id:number,right:number,forward:number)=>void;
 release:(id:number)=>void;
}
export function joystickVector(dx:number,dy:number,radius:number){
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(radius)||radius<=0)return {x:0,y:0,right:0,forward:0};
 const length=Math.hypot(dx,dy),distance=Math.min(1,length/radius),strength=Math.max(0,(distance-.12)/.88);
 const nx=length?dx/length:0,ny=length?dy/length:0;
 return {x:nx*distance*radius,y:ny*distance*radius,right:nx*strength,forward:-ny*strength};
}

/** Owns one control gesture only. Navigation, speed and pause remain in the input owner. */
export function createJoystickGesture(changed:(x:number,y:number)=>void){
 let active:{id:number;actions:JoystickActions;cx:number;cy:number;radius:number}|undefined;
 const move=(id:number,x:number,y:number)=>{
  if(active?.id!==id)return;
  const vector=joystickVector(x-active.cx,y-active.cy,active.radius);
  changed(vector.x,vector.y);active.actions.move(id,vector.right,vector.forward);
 };
 const clear=()=>{
  if(!active)return;
  const previous=active;active=undefined;
  previous.actions.release(previous.id);changed(0,0);
 };
 return {
  begin(id:number,x:number,y:number,rect:{left:number;top:number;width:number;height:number},actions:JoystickActions){
   if(active||!Number.isFinite(id)||![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||Math.min(rect.width,rect.height)<=44)return false;
   active={id,actions,cx:rect.left+rect.width/2,cy:rect.top+rect.height/2,radius:Math.min(rect.width,rect.height)/2-22};
   move(id,x,y);return true;
  },
  move,
  end(id:number){if(active?.id===id)clear();},
  clear,
  active:()=>active?.id,
 };
}
