// SPDX-License-Identifier: AGPL-3.0-or-later
export interface DetailView { yaw: number; pitch: number; zoom: number; panX?:number; panY?:number }
export const INITIAL_DETAIL_VIEW: DetailView = { yaw: 0, pitch: 0, zoom: 1 };
export function detailView(view: DetailView): DetailView {
  const next:DetailView={yaw:((view.yaw+180)%360+360)%360-180,
    pitch:Math.max(-90,Math.min(90,view.pitch)),zoom:Math.max(.5,Math.min(3,view.zoom))};
  const pan=(value:number)=>Math.max(-240,Math.min(240,value));
  if(view.panX!==undefined&&Number.isFinite(view.panX))next.panX=pan(view.panX);
  if(view.panY!==undefined&&Number.isFinite(view.panY))next.panY=pan(view.panY);
  return next;
}
interface Point { x: number; y: number }
/** Incremental deltas keep pointer-count transitions anchored to the current view. */
export class DetailGesture {
  private points = new Map<number, Point>();
  begin(id: number, point: Point) { if (this.points.size < 2) this.points.set(id, point); }
  move(id: number, point: Point, view: DetailView): DetailView {
    const previous = this.points.get(id);
    if (!previous) return view;
    const other = [...this.points].find(([key]) => key !== id)?.[1];
    this.points.set(id, point);
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      if(before<=2||after<=2||point.x===previous.x&&point.y===previous.y)return view;
      return detailView({...view,zoom:view.zoom*after/before,
        panX:(view.panX??0)+(point.x-previous.x)/2,panY:(view.panY??0)+(point.y-previous.y)/2});
    }
    return detailView({ ...view, yaw: view.yaw + (point.x - previous.x) * .5,
      pitch: view.pitch + (point.y - previous.y) * .5 });
  }
  end(id: number) { this.points.delete(id); }
  clear() { this.points.clear(); }
}
