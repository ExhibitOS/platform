// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from 'vitest';
import { DetailGesture, detailView, INITIAL_DETAIL_VIEW } from './detail-gesture';

it('rotates both axes, wraps yaw and limits pitch without changing model scale', () => {
  const gesture = new DetailGesture();
  gesture.begin(1, { x: 0, y: 0 });
  expect(gesture.move(1, { x: 800, y: 400 }, INITIAL_DETAIL_VIEW)).toEqual({ yaw: 40, pitch: 90, zoom: 1 });
  expect(detailView({ yaw: -541, pitch: -120, zoom: 4 })).toEqual({ yaw: 179, pitch: -90, zoom: 3 });
});
it('pinches relative to current distance and transitions one to two to one without a jump', () => {
  const gesture = new DetailGesture();
  gesture.begin(1, { x: 0, y: 0 });
  let view = gesture.move(1, { x: 20, y: 10 }, INITIAL_DETAIL_VIEW);
  gesture.begin(2, { x: 120, y: 10 });
  expect(gesture.move(2, { x: 120, y: 10 }, view)).toEqual(view);
  view = gesture.move(2, { x: 220, y: 10 }, view);
  expect(view).toEqual({ yaw: 10, pitch: 5, zoom: 2 });
  gesture.end(1);
  expect(gesture.move(2, { x: 220, y: 10 }, view)).toEqual(view);
  expect(gesture.move(2, { x: 230, y: 20 }, view)).toEqual({ yaw: 15, pitch: 10, zoom: 2 });
});
it('bounds zoom and rejects degenerate pinch, ended, extra and cleared pointers', () => {
  const gesture = new DetailGesture();
  gesture.begin(1, { x: 0, y: 0 }); gesture.begin(2, { x: 0, y: 0 });
  expect(gesture.move(2, { x: 100, y: 0 }, INITIAL_DETAIL_VIEW)).toEqual(INITIAL_DETAIL_VIEW);
  expect(gesture.move(2, { x: 1000, y: 0 }, INITIAL_DETAIL_VIEW).zoom).toBe(3);
  expect(gesture.move(2, { x: 3, y: 0 }, INITIAL_DETAIL_VIEW).zoom).toBe(.5);
  gesture.begin(3, { x: 0, y: 0 });
  expect(gesture.move(3, { x: 100, y: 100 }, INITIAL_DETAIL_VIEW)).toEqual(INITIAL_DETAIL_VIEW);
  gesture.end(2);
  expect(gesture.move(2, { x: 300, y: 0 }, INITIAL_DETAIL_VIEW)).toEqual(INITIAL_DETAIL_VIEW);
  gesture.clear();
  expect(gesture.move(1, { x: 100, y: 100 }, INITIAL_DETAIL_VIEW)).toEqual(INITIAL_DETAIL_VIEW);
});
