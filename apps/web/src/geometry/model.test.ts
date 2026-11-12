import { describe, it, expect } from "vitest";
import {
  MATERIAL_NAMESPACE,
  validateStudioMaterials,
  roomBaseLight,lightDetailsFor,roomBaseLightRange,LIGHT_DETAILS_NAMESPACE,lightAttachmentsFor,
} from "@exhibitos/studio-contract";
import { newDraft } from "../drafts/example";
import {newLight} from "../placement/model";
import { validateDraft } from "../drafts/validator";
import {
  createGeometryState,
  applyGeometryCommand,
  undoGeometry,
  redoGeometry,
  newRoom,
  newDoor,
  GeometryError,
} from "./model";

describe("validated reversible meter geometry commands", () => {
  it("creates six correctly oriented room-local planes, preserves foreign metadata, and roundtrips undo/redo", () => {
    const draft = newDraft();
    draft.candidate.extensions = { "example.org/other": { note: "preserved" } };
    const base = createGeometryState(draft.candidate),
      room = base.present.rooms[0]!;
    const cube = applyGeometryCommand(base, {
      type: "white-cube",
      roomId: room.id,
    });
    expect(cube.present.surfaces).toHaveLength(6);
    expect(cube.present.surfaces.map((s) => s.transform.position)).toEqual([
      [0, 2, -4],
      [0, 2, 4],
      [-6, 2, 0],
      [6, 2, 0],
      [0, 0, 0],
      [0, 4, 0],
    ]);
    expect(
      cube.present.surfaces.every(
        (s) =>
          Math.abs(s.transform.rotation.reduce((n, v) => n + v * v, 0) - 1) <
          1e-12,
      ),
    ).toBe(true);
    expect(undoGeometry(cube).present).toEqual(base.present);
    expect(redoGeometry(undoGeometry(cube)).present).toEqual(cube.present);
    expect(cube.present.extensions).toEqual(base.present.extensions);
    expect(() =>
      applyGeometryCommand(cube, { type: "white-cube", roomId: room.id }),
    ).toThrow("ROOM_HAS_SURFACES");
    expect(base.present.surfaces).toHaveLength(0);
  });
  it("rejects negative dimensions, unnormalized/scale transforms, dangling refs and invalid materials without altering snapshots", () => {
    const draft = newDraft(),
      base = createGeometryState(draft.candidate),
      room = base.present.rooms[0]!;
    const state = applyGeometryCommand(base, {
        type: "white-cube",
        roomId: room.id,
      }),
      wall = state.present.surfaces[0]!;
    const before = JSON.stringify(state);
    for (const bad of [
      {
        type: "set-room",
        id: room.id,
        room: { ...room, dimensions: { ...room.dimensions, width: -1 } },
      },
      {
        type: "set-room",
        id: room.id,
        room: {
          ...room,
          transform: { ...room.transform, rotation: [0, 0, 0, 2] },
        },
      },
      {
        type: "set-room",
        id: room.id,
        room: { ...room, transform: { ...room.transform, scale: [2, 1, 1] } },
      },
      {
        type: "add-opening",
        opening: newDoor(crypto.randomUUID(), { width: 1, height: 2 }, [0, 0]),
      },
      { type: "remove-room", id: room.id },
      {
        type: "set-material",
        surfaceId: wall.id,
        material: { color: "#AABBCC", roughness: 0.5, metalness: 0 },
      },
      {
        type: "set-material",
        surfaceId: wall.id,
        material: { color: "#aabbcc", roughness: Infinity, metalness: 0 },
      },
    ] as Parameters<typeof applyGeometryCommand>[1][]) {
      expect(() => applyGeometryCommand(state, bad)).toThrow(GeometryError);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it("pairs distinct-room doors atomically, refuses referenced removals, disconnects both endpoints and undoes exact metadata", () => {
    let state = createGeometryState(newDraft().candidate);
    const firstRoom = state.present.rooms[0]!;
    state = applyGeometryCommand(state, {
      type: "white-cube",
      roomId: firstRoom.id,
    });
    const secondRoom = newRoom("Second", { width: 12, height: 4, depth: 8 });
    secondRoom.transform.position = [20, 0, 0];
    state = applyGeometryCommand(state, { type: "add-room", room: secondRoom });
    state = applyGeometryCommand(state, {
      type: "white-cube",
      roomId: secondRoom.id,
    });
    const walls = [state.present.surfaces[0]!, state.present.surfaces[6]!],
      doors = walls.map((w) => newDoor(w.id, { width: 1, height: 2 }, [0, -1]));
    for (const opening of doors)
      state = applyGeometryCommand(state, { type: "add-opening", opening });
    const unpaired = state;
    state = applyGeometryCommand(state, {
      type: "connect-doors",
      firstId: doors[0]!.id,
      secondId: doors[1]!.id,
    });
    expect(state.present.openings.map((d) => d.connectsToOpeningId)).toEqual([
      doors[1]!.id,
      doors[0]!.id,
    ]);
    expect(() =>
      applyGeometryCommand(state, { type: "remove-opening", id: doors[0]!.id }),
    ).toThrow("DOOR_CONNECTED");
    expect(() =>
      applyGeometryCommand(state, { type: "remove-surface", id: walls[0]!.id }),
    ).toThrow(GeometryError);
    const paired = state;
    state = applyGeometryCommand(state, {
      type: "disconnect-door",
      id: doors[0]!.id,
    });
    expect(state.present.openings).toEqual(unpaired.present.openings);
    expect(undoGeometry(state).present).toEqual(paired.present);
  });
  it("bounds undo to20, clears redo on branch and removes only deleted surface material assignments", () => {
    let state = createGeometryState(newDraft().candidate);
    const room = state.present.rooms[0]!;
    state = applyGeometryCommand(state, {
      type: "white-cube",
      roomId: room.id,
    });
    const wall = state.present.surfaces[0]!;
    state = applyGeometryCommand(state, {
      type: "set-material",
      surfaceId: wall.id,
      material: { color: "#112233", roughness: 0.3, metalness: 0.6 },
    });
    const material = state.present.extensions?.[MATERIAL_NAMESPACE];
    state = applyGeometryCommand(state, {
      type: "remove-surface",
      id: wall.id,
    });
    expect(state.present.extensions?.[MATERIAL_NAMESPACE]).toEqual({
      version: 1,
      surfaces: {},
    });
    expect(
      undoGeometry(state).present.extensions?.[MATERIAL_NAMESPACE],
    ).toEqual(material);
    state = undoGeometry(state);
    state = applyGeometryCommand(state, {
      type: "set-material",
      surfaceId: wall.id,
      material: null,
    });
    expect(state.future).toEqual([]);
    for (let i = 0; i < 25; i++)
      state = applyGeometryCommand(state, {
        type: "set-room",
        id: room.id,
        room: { ...room, name: `Room ${i}` },
      });
    expect(state.past).toHaveLength(20);
    expect(state.present.rooms[0]!.name).toBe("Room 24");
  });
  it("known namespace rejects unknown versions, duplicate case aliases and missing references even in generic draft JSON", () => {
    const draft = newDraft();
    draft.candidate = applyGeometryCommand(
      createGeometryState(draft.candidate),
      { type: "white-cube", roomId: draft.candidate.rooms[0]!.id },
    ).present;
    const surface = draft.candidate.surfaces[0]!,
      good = { color: "#112233", roughness: 0, metalness: 1 };
    for (const extension of [
      { version: 2, surfaces: {} },
      { version: 1, surfaces: { [crypto.randomUUID()]: good } },
      {
        version: 1,
        surfaces: { [surface.id]: good, [surface.id.toUpperCase()]: good },
      },
      { version: 1, surfaces: { [surface.id]: { ...good, metalness: 2 } } },
    ]) {
      draft.candidate.extensions = { [MATERIAL_NAMESPACE]: extension };
      expect(validateDraft(draft).valid).toBe(false);
      expect(validateStudioMaterials(draft.candidate).valid).toBe(false);
    }
    draft.candidate.extensions = {
      [MATERIAL_NAMESPACE]: {
        version: 1,
        surfaces: { [surface.id.toUpperCase()]: good },
      },
    };
    expect(validateDraft(draft).valid).toBe(true);
  });
});

describe('atomic explicit room-base placement lifecycle',()=>{
  it('ordinary room creation owns one automatic base light in the same undo step',()=>{
    const before=createGeometryState(newDraft().candidate),room=newRoom('Added',{width:10,height:5,depth:8},{position:[20,0,0],rotation:[0,0,0,1],scale:[1,1,1]}),created=applyGeometryCommand(before,{type:'add-room',room});
    const light=roomBaseLight(created.present,room.id)!;expect(light).toBeDefined();expect(light.transform.position).toEqual([0,4.5,0]);
    expect(lightDetailsFor(created.present).find(v=>v.lightId===light.id)).toMatchObject({purpose:'room-base',basePlacement:'auto',range:roomBaseLightRange(room.dimensions)});
    expect(created.past).toHaveLength(before.past.length+1);expect(undoGeometry(created).present).toEqual(before.present);expect(redoGeometry(undoGeometry(created)).present).toEqual(created.present);
    expect(applyGeometryCommand(created,{type:'ensure-room-base-light',roomId:room.id})).toBe(created);
  });
  it('room resize reflows only owned automatic placement and keeps brightness, colour and off state',()=>{
    let state=createGeometryState(newDraft().candidate);const roomId=state.present.rooms[0]!.id;
    state=applyGeometryCommand(state,{type:'ensure-room-base-light',roomId});const light=roomBaseLight(state.present,roomId)!,{id,...fields}=light;
    state=applyGeometryCommand(state,{type:'set-light',id,light:{...fields,intensity:0,color:[.2,.3,.4]}});
    expect(lightDetailsFor(state.present).find(v=>v.lightId===id)?.basePlacement).toBe('auto');
    const previous=state,room=state.present.rooms[0]!,moved=applyGeometryCommand(state,{type:'set-room',id:roomId,room:{...room,dimensions:{width:16,height:6,depth:10},transform:{...room.transform,position:[20,0,-3]}}});
    expect(roomBaseLight(moved.present,roomId)).toMatchObject({intensity:0,color:[.2,.3,.4],transform:{position:[0,5.4,0]}});
    expect(lightDetailsFor(moved.present).find(v=>v.lightId===id)?.range).toBe(roomBaseLightRange({width:16,height:6,depth:10}));
    expect(undoGeometry(moved).present).toEqual(previous.present);expect(redoGeometry(undoGeometry(moved)).present).toEqual(moved.present);
  });
  it('manual spatial edits change known auto intent atomically while equivalent quaternion sign does not',()=>{
    let state=createGeometryState(newDraft().candidate);const roomId=state.present.rooms[0]!.id;state=applyGeometryCommand(state,{type:'ensure-room-base-light',roomId});
    const light=roomBaseLight(state.present,roomId)!,{id,...fields}=light;
    const sign=applyGeometryCommand(state,{type:'set-light',id,light:{...fields,transform:{...fields.transform,rotation:[0,0,0,-1]}}});
    expect(lightDetailsFor(sign.present).find(v=>v.lightId===id)?.basePlacement).toBe('auto');
    const manual=applyGeometryCommand(state,{type:'set-light',id,light:{...fields,transform:{...fields.transform,position:[1,2,1]}}});
    expect(lightDetailsFor(manual.present).find(v=>v.lightId===id)?.basePlacement).toBe('manual');expect(undoGeometry(manual).present).toEqual(state.present);
    const room=manual.present.rooms[0]!,resized=applyGeometryCommand(manual,{type:'set-room',id:roomId,room:{...room,dimensions:{width:14,height:5,depth:10}}});
    expect(roomBaseLight(resized.present,roomId)!.transform).toEqual(roomBaseLight(manual.present,roomId)!.transform);
  });
  it('unknown legacy intent is never inferred from the former automatic coordinates or spatial edits',()=>{
    const draft=newDraft(),room=draft.candidate.rooms[0]!,light=newLight(room.id,'point'),{id,...fields}=light;
    light.transform.position=[0,room.dimensions.height*.9,0];draft.candidate.lights=[light];
    draft.candidate.extensions={...draft.candidate.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:[{lightId:id,fixture:'none',purpose:'room-base',range:12}]}};
    const state=createGeometryState(draft.candidate),before=lightDetailsFor(state.present),resized=applyGeometryCommand(state,{type:'set-room',id:room.id,room:{...room,dimensions:{width:14,height:6,depth:10}}});
    expect(roomBaseLight(resized.present,room.id)).toEqual(light);expect(lightDetailsFor(resized.present)).toEqual(before);
    const edited=applyGeometryCommand(state,{type:'set-light',id,light:{...fields,transform:{...light.transform,position:[1,2,1]}}});
    expect(lightDetailsFor(edited.present)).toEqual(before);expect(lightDetailsFor(edited.present)[0]!.basePlacement).toBeUndefined();
  });
  it('typed restore-auto clears its attachment and preserves zero intensity/colour with exact undo',()=>{
    let state=createGeometryState(newDraft().candidate);const roomId=state.present.rooms[0]!.id;
    state=applyGeometryCommand(state,{type:'white-cube',roomId});state=applyGeometryCommand(state,{type:'ensure-room-base-light',roomId});
    const light=roomBaseLight(state.present,roomId)!,{id,...fields}=light;state=applyGeometryCommand(state,{type:'set-light',id,light:{...fields,intensity:0,color:[.1,.2,.3]}});
    const ceiling=state.present.surfaces.find(v=>v.type==='ceiling')!;state=applyGeometryCommand(state,{type:'set-light-attachment',lightId:id,attachment:{surfaceId:ceiling.id,anchor:[1,1],gap:.5}});
    expect(lightDetailsFor(state.present).find(v=>v.lightId===id)?.basePlacement).toBe('manual');expect(lightAttachmentsFor(state.present)).toHaveLength(1);
    const before=state,restored=applyGeometryCommand(state,{type:'set-room-base-light-placement',lightId:id,basePlacement:'auto'});
    expect(roomBaseLight(restored.present,roomId)).toMatchObject({intensity:0,color:[.1,.2,.3],transform:{position:[0,3.6,0]}});expect(lightAttachmentsFor(restored.present)).toEqual([]);
    expect(lightDetailsFor(restored.present).find(v=>v.lightId===id)?.basePlacement).toBe('auto');expect(undoGeometry(restored).present).toEqual(before.present);expect(redoGeometry(undoGeometry(restored)).present).toEqual(restored.present);
  });
  it('removing the base light never recreates it on room edits and failed edits preserve history',()=>{
    let state=createGeometryState(newDraft().candidate);const roomId=state.present.rooms[0]!.id;state=applyGeometryCommand(state,{type:'ensure-room-base-light',roomId});
    const base=state;state=applyGeometryCommand(state,{type:'remove-light',id:roomBaseLight(state.present,roomId)!.id});
    expect(undoGeometry(state).present).toEqual(base.present);const room=state.present.rooms[0]!;
    const moved=applyGeometryCommand(state,{type:'set-room',id:roomId,room:{...room,dimensions:{width:14,height:5,depth:8}}});expect(roomBaseLight(moved.present,roomId)).toBeUndefined();
    const before=structuredClone(moved);expect(()=>applyGeometryCommand(moved,{type:'set-room',id:roomId,room:{...room,dimensions:{width:-1,height:5,depth:8}}})).toThrow();expect(moved).toEqual(before);
  });
});
