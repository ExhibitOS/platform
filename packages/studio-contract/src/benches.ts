// SPDX-License-Identifier: AGPL-3.0-or-later
import {artifactCorners} from './artifact-affine.js';
import {benchBoxes} from './bench-shape.js';
import type {ArtifactPose} from './artifact-affine.js';
import type { Exhibition } from '@exhibitos/spec';
import type { InstallationMaterial } from './installation.js';
import { PRESENTATION_NAMESPACE, presentationFor, validateStudioPresentation } from './index.js';
import type { StudioCamera } from './index.js';

export const BENCH_NAMESPACE = 'org.exhibitos.studio/benches';
export const BENCH_LIMITS = Object.freeze({ benches: 32, materials: 32, boxes: 224, triangles: 2688, bytes: 32768 });
/** Floor-contact centre in room-local metres; +Y up, forward -Z, yaw in radians.
 * Height is the seat top. A backed bench adds a .4m back above that height.
 * The existing presentation viewpoint owns the seated eye, target and FOV.
 */
export interface StudioBench {
  id: string;
  name: string;
  roomId: string;
  position: [number, number, number];
  yaw: number;
  kind: 'slab' | 'backed';
  dimensions: { width: number; depth: number; height: number };
  material: InstallationMaterial;
  viewpointId: string;
}
export interface StudioBenches { version: 1; benches: StudioBench[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => keys.length === Object.keys(v).length && keys.every(k => Object.hasOwn(v, k));
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => finite(n, -10000, 10000));
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Namespace admission is additional to full exhibition/presentation validation.
 * Physics floor, artwork and head clearance are checked again before explicit Sit.
 */
export function validateStudioBenches(candidate: unknown) {
  const errors: { code: string; path: string; message: string }[] = [];
  const add = (code: string, path: string, message: string) => errors.push({ code, path: '/candidate/extensions/org.exhibitos.studio~1benches' + path, message });
  if (!object(candidate) || !object(candidate.extensions) || !Object.hasOwn(candidate.extensions, BENCH_NAMESPACE)) return { valid: true, errors };
  const value = candidate.extensions[BENCH_NAMESPACE];
  if (!object(value) || !closed(value, ['version', 'benches']) || value.version !== 1 || !Array.isArray(value.benches)) {
    add('BENCH_SCHEMA', '', 'Expected closed benches version 1');
    return { valid: false, errors };
  }
  if (value.benches.length > BENCH_LIMITS.benches) {
    add('BENCH_LIMIT', '/benches', 'Maximum 32 benches');
    return { valid: false, errors };
  }
  const rooms = Array.isArray(candidate.rooms) ? candidate.rooms.filter(object) : [];
  const presentation = candidate.extensions[PRESENTATION_NAMESPACE];
  const viewpoints = object(presentation) && Array.isArray(presentation.viewpoints) ? presentation.viewpoints.filter(object) : [];
  const seen = new Set<string>();
  value.benches.forEach((b, i) => {
    const path = '/benches/' + i;
    if (!object(b) || !closed(b, ['id','name','roomId','position','yaw','kind','dimensions','material','viewpointId']) || !uuid(b.id) || !uuid(b.roomId) || !uuid(b.viewpointId) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 128 || !vector(b.position) || !finite(b.yaw, -Math.PI, Math.PI) || (b.kind!=='slab'&&b.kind!=='backed')) {
      add('BENCH_SCHEMA', path, 'Expected a named bounded bench with UUID references'); return;
    }
    const d = b.dimensions, m = b.material;
    if (!object(d) || !closed(d, ['width','depth','height']) || !finite(d.width,.6,3) || !finite(d.depth,.3,1) || !finite(d.height,.3,.65) || !object(m) || !closed(m,['preset','color','roughness','metalness']) || (m.preset!=='paint'&&m.preset!=='wood'&&m.preset!=='stone'&&m.preset!=='metal') || typeof m.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.color) || !finite(m.roughness,0,1) || !finite(m.metalness,0,1)) {
      add('BENCH_SCHEMA', path, 'Invalid size or existing PBR material'); return;
    }
    if (seen.has(b.id.toLowerCase())) add('BENCH_REFERENCE', path+'/id', 'Bench UUID must be unique');
    seen.add(b.id.toLowerCase());
    const room = rooms.find(r => typeof r.id === 'string' && equal(r.id,b.roomId as string));
    const view = viewpoints.find(v => typeof v.id === 'string' && equal(v.id,b.viewpointId as string));
    if (!room || !object(room.dimensions) || !view || typeof view.roomId !== 'string' || !equal(view.roomId,b.roomId) || !vector(view.position) || !vector(view.target)) {
      add('BENCH_REFERENCE', path, 'Bench and existing viewpoint must share an existing room'); return;
    }
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), halfX = (Math.abs(c)*d.width+Math.abs(s)*d.depth)/2, halfZ = (Math.abs(s)*d.width+Math.abs(c)*d.depth)/2;
    if (b.position[1] < 0 || Math.abs(b.position[0])+halfX > Number(room.dimensions.width)/2 || Math.abs(b.position[2])+halfZ > Number(room.dimensions.depth)/2 || b.position[1]+d.height+(b.kind==='backed'?.4:0) > Number(room.dimensions.height)) add('BENCH_BOUNDS',path,'Complete bench must fit inside its room');
    try {
      const bench=b as unknown as StudioBench,pose:ArtifactPose={position:bench.position,rotation:[0,Math.sin(bench.yaw/2),0,Math.cos(bench.yaw/2)],scale:[1,1,1]};
      for(const box of benchBoxes(bench))artifactCorners(box.dimensions,[{position:box.position,rotation:[0,0,0,1],scale:[1,1,1]},pose,room.transform as unknown as ArtifactPose],true);
    } catch {add('BENCH_BOUNDS',path,'Generated world geometry must satisfy finite affine and Float32 hull limits');}
    const dx=view.position[0]-b.position[0], dz=view.position[2]-b.position[2], x=c*dx-s*dz, z=s*dx+c*dz, eye=view.position[1]-b.position[1];
    if (Math.abs(x)>d.width/2-.05 || Math.abs(z)>d.depth/2-.05 || eye<d.height+.5 || eye>d.height+1.1 || Math.hypot(view.target[0]-view.position[0],view.target[2]-view.position[2])<.001) add('BENCH_VIEWPOINT',path+'/viewpointId','Seated eye must be above the seat footprint with a horizontal viewing direction');
  });
  try { if (new TextEncoder().encode(JSON.stringify(value)).length > BENCH_LIMITS.bytes) add('BENCH_LIMIT','','Maximum 32 KiB bench metadata'); }
  catch { add('BENCH_SCHEMA','','Expected finite JSON metadata'); }
  return { valid: errors.length === 0, errors };
}

/** Call after full validation; absence leaves legacy documents unchanged. */
export function benchesFor(candidate: Pick<Exhibition,'extensions'>): StudioBench[] {
  return structuredClone((candidate.extensions?.[BENCH_NAMESPACE] as unknown as StudioBenches | undefined)?.benches ?? []);
}
/** Remap typed identities only. Callers allocate bench IDs before this projection. */
export function remapStudioBenches(value: StudioBenches, ids: ReadonlyMap<string,string>): StudioBenches {
  const map = (id: string) => { const next=ids.get(id.toLowerCase()); if (!uuid(next)) throw Error('BENCH_REFERENCE'); return next; };
  return { version:1, benches:value.benches.map(b => ({...structuredClone(b),id:map(b.id),roomId:map(b.roomId),viewpointId:map(b.viewpointId)})) };
}

export type BenchCommand = {type:'add-bench'|'set-bench';bench:StudioBench;viewpoint?:StudioCamera & {id:string;name:string}}|{type:'remove-bench';benchId:string};
/** Pure candidate edit; caller owns full draft validation, auth, revision and history. */
export function applyBenchCommand(candidate: Exhibition, command: BenchCommand): Exhibition {
  const next=structuredClone(candidate), benches=benchesFor(next);
  if (command.type!=='remove-bench') {
    const index=benches.findIndex(b=>equal(b.id,command.bench.id));
    if(command.type==='add-bench'&&index>=0||command.type==='set-bench'&&index<0)throw Error('BENCH_REFERENCE');
    if(command.viewpoint){
      const presentation=presentationFor(next);
      if(!equal(command.viewpoint.id,command.bench.viewpointId)||presentation.viewpoints.some(v=>equal(v.id,command.viewpoint!.id)))throw Error('BENCH_REFERENCE');
      presentation.viewpoints.push(structuredClone(command.viewpoint));
      next.extensions={...next.extensions,[PRESENTATION_NAMESPACE]:presentation as unknown as NonNullable<Exhibition['extensions']>[string]};
    }
    if(index<0)benches.push(structuredClone(command.bench));else benches[index]=structuredClone(command.bench);
  } else {
    const index=benches.findIndex(b=>equal(b.id,command.benchId));
    if(index<0)throw Error('BENCH_REFERENCE');benches.splice(index,1);
  }
  next.extensions={...next.extensions,[BENCH_NAMESPACE]:{version:1,benches} as unknown as NonNullable<Exhibition['extensions']>[string]};
  if(!validateStudioBenches(next).valid||!validateStudioPresentation(next).valid)throw Error('BENCH_INVALID');
  return next;
}
