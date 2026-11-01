// SPDX-License-Identifier: AGPL-3.0-or-later

/** Track physical contacts separately from synthetic cancellation events. */
export class EditorPointerArbitration {
 private readonly active=new Set<number>();
 private multiGesture=false;
 get busy(){return this.active.size>0;}
 get multiple(){return this.active.size>1;}
 get activeIds(){return [...this.active];}
 get suppressSelection(){return this.multiGesture;}
 down(pointerId:number,canvas:boolean){
  if(this.active.has(pointerId))return false;
  if(canvas&&this.active.size===0)this.multiGesture=false;
  const startsMultiple=this.active.size===1;
  this.active.add(pointerId);
  if(this.active.size>1){this.multiGesture=true;return startsMultiple;}
  return false;
 }
 up(pointerId:number){this.active.delete(pointerId);}
 clear(){this.active.clear();this.multiGesture=true;}
}
