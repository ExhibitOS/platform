// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect } from "vitest";
import { PRESENTATION_NAMESPACE } from "@exhibitos/studio-contract";
import { newDraft } from "../drafts/example";
import { createGeometryState, applyGeometryCommand } from "../geometry/model";
import { syntheticArtwork, newPlacement } from "../placement/model";
import { createNavigationController } from "./navigation";
import { teleportToViewpoint } from "./navigation-teleport";
function fixture() {
  let geometry=createGeometryState(newDraft().candidate);
  geometry=applyGeometryCommand(geometry,{type:"white-cube",roomId:geometry.present.rooms[0]!.id});
  geometry.present.artworks=[];geometry.present.placements=[];
  return geometry.present;
}
function viewpoint(doc:ReturnType<typeof fixture>,position:[number,number,number],target:[number,number,number]) {
  const id=crypto.randomUUID();
  doc.extensions={...doc.extensions,[PRESENTATION_NAMESPACE]:{version:1,viewpoints:[{id,name:"Synthetic safe viewpoint",roomId:doc.rooms[0]!.id,position,target,fov:55}],credits:""}};
  return id;
}
test("authored teleport uses actual Rapier capsule/floor validation, world room rotation and paused immediate pose",async()=>{
  const doc=fixture(),room=doc.rooms[0]!;
  room.transform.position=[10,0,20];room.transform.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];
  const id=viewpoint(doc,[1,1.6,1],[1,1.6,0]);
  const controller=await createNavigationController(doc,{position:[10,1.6,23]});
  try {
    const result=teleportToViewpoint(controller,doc,id);
    expect(result.state.eyePosition[0]).toBeCloseTo(11,5);expect(result.state.eyePosition[2]).toBeCloseTo(19,5);
    expect(result.state.yaw).toBeCloseTo(Math.PI/2,5);
    expect(result.state.grounded).toBe(true);expect(result.state.paused).toBe(true);
    expect(result.state.velocity).toEqual([0,0,0]);expect(result.fov).toBe(55);
    const position=result.state.eyePosition;
    controller.advance(.1,{forward:0,right:0});expect(controller.state().eyePosition).toEqual(position);
  } finally {controller.dispose();}
});
test("unsafe authored floor/artwork destinations and arbitrary ids retain prior camera pose and pause",async()=>{
  for(const obstacle of [false,true]){
    const doc=fixture();
    if(obstacle){const artwork=syntheticArtwork("sculpture");doc.artworks=[artwork];doc.placements=[newPlacement(artwork,doc.rooms[0]!.id)];doc.placements[0]!.transform.position=[0,.5,0];}
    const id=viewpoint(doc,obstacle?[0,1.6,0]:[100,1.6,100],obstacle?[0,1.6,-1]:[100,1.6,99]);
    const controller=await createNavigationController(doc,{position:[0,1.6,3]});
    try {
      controller.advance(.1,{forward:1,right:0});const before=controller.state();
      expect(()=>teleportToViewpoint(controller,doc,id)).toThrow("NAVIGATION_SPAWN_UNSAFE");
      expect(controller.state().eyePosition).toEqual(before.eyePosition);expect(controller.state().yaw).toBe(before.yaw);
      expect(controller.state().paused).toBe(true);expect(controller.state().velocity).toEqual([0,0,0]);
      expect(()=>teleportToViewpoint(controller,doc,crypto.randomUUID())).toThrow("TELEPORT_VIEWPOINT_UNAVAILABLE");
      expect(controller.state().eyePosition).toEqual(before.eyePosition);
    } finally {controller.dispose();}
  }
});
