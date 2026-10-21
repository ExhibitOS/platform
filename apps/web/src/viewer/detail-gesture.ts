// SPDX-License-Identifier: AGPL-3.0-or-later
export interface DetailView { yaw: number; pitch: number; zoom: number }
export const INITIAL_DETAIL_VIEW: DetailView = { yaw: 0, pitch: 0, zoom: 1 };
export function detailView(view: DetailView): DetailView {
  return { yaw: ((view.yaw + 180) % 360 + 360) % 360 - 180,
    pitch: Math.max(-90, Math.min(90, view.pitch)), zoom: Math.max(.5, Math.min(3, view.zoom)) };
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
      return before > 2 && after > 2 ? detailView({ ...view, zoom: view.zoom * after / before }) : view;
    }
    return detailView({ ...view, yaw: view.yaw + (point.x - previous.x) * .5,
      pitch: view.pitch + (point.y - previous.y) * .5 });
  }
  end(id: number) { this.points.delete(id); }
  clear() { this.points.clear(); }
}
