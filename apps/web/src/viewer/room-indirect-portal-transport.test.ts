// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fixtureURL, readOex, revisionHash, type Exhibition } from '@exhibitos/spec';
import { WORKSPACE_FURNISHING_NAMESPACE } from '@exhibitos/studio-contract';
import { expect, it } from 'vitest';
import { validateWorkspaceFurnishingGlb } from '../../../api/src/workspace-furnishing-glb';
import { openRoomIndirectPortal } from './room-indirect-portal';

const require = createRequire(import.meta.url);
const { localStaticPublicationSource } = require('../../../../scripts/local-static-publication-source.mjs') as {
  localStaticPublicationSource(input: {sourceDir: string; sourceManifestSha256: string; indexSha256: string;
    publicationId: string; revisionSha256: string}): Promise<{read(path: string): Promise<Buffer>}>;
};
type Baked = {status:'baked'; descriptorSha256:string; files:Map<string,Buffer>};
type Recipe = {sha256:string; digests:string[]};
const { readInstalledRoomIndirectRecipe, readRoomIndirectRecipe, roomIndirectPortalWorkerPath,
  roomIndirectRecipeMarkerPath, roomIndirectRecipeScripts } = require('../../../../scripts/room-indirect-recipe.mjs') as {
  readInstalledRoomIndirectRecipe(root:string): Promise<Recipe>;
  readRoomIndirectRecipe(root:string, includePortalWorker?:boolean): Promise<Recipe>;
  roomIndirectPortalWorkerPath:string; roomIndirectRecipeMarkerPath:string; roomIndirectRecipeScripts:string[];
};
const { prepareRoomIndirect } = require('../../../../scripts/prepare-room-indirect.mjs') as {
  prepareRoomIndirect(input: {publication: unknown; bodyBytes: Buffer; indexBytes: Buffer;
    stagedAssets: {assets: unknown[]; read(path: string): Promise<Buffer>}},
  options: {readRecipe:() => Promise<Recipe>;loadPortal:(sha256:string) => Promise<typeof openRoomIndirectPortal>}):
    Promise<Baked | {status:'live-fallback'}>;
};

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const q = Math.SQRT1_2;
const roomId = randomUUID(), openingId = randomUUID(), furnishingId = randomUUID();
const spaceLighting = {version:1, mode:'room-local', baselineIntensity:0, reflectionIntensity:0};
const room: Exhibition['rooms'][number] = {
  id:roomId, name:'Portal transport control', dimensions:{width:3.2,depth:3,height:3},
  transform:{position:[8,0,-4],rotation:[0,q,0,q],scale:[1,1,1]},
};
const surface = (type: 'floor' | 'ceiling' | 'wall', width: number, height: number,
  position: [number,number,number], rotation: [number,number,number,number],
): Exhibition['surfaces'][number] => ({
  id:randomUUID(),roomId,type,dimensions:{width,height},transform:{position,rotation,scale:[1,1,1]},
});
const floor = surface('floor',3.2,3,[0,0,0],[-q,0,0,q]);
const portalWall = surface('wall',3.2,3,[0,1.5,-1.5],[0,0,0,1]);
const surfaces = [
  floor, surface('ceiling',3.2,3,[0,3,0],[q,0,0,q]),
  surface('wall',3,3,[1.6,1.5,0],[0,-q,0,q]), surface('wall',3,3,[-1.6,1.5,0],[0,q,0,q]),
  surface('wall',3.2,3,[0,1.5,1.5],[0,1,0,0]), portalWall,
];

async function stage(root: string, exhibition: Exhibition, model: Buffer) {
  const file = { assetId:furnishingId, sha256:sha(model),bytes:model.length,mime:'model/gltf-binary' };
  const asset = { ...file,path:`data/${file.sha256}.bin` };
  const publicationId = randomUUID(), revisionSha256 = revisionHash(exhibition);
  const publication = {publication:{id:publicationId,revisionSha256,status:'published'},exhibition,assets:[file]};
  const bodyBytes = json(publication);
  const body = {path:`data/${sha(bodyBytes)}.json`,bytes:bodyBytes.length,sha256:sha(bodyBytes),mime:'application/json'};
  const indexBytes = json({version:1,publication:body,assets:[asset]});
  const indexSha256 = sha(indexBytes);
  const files = [
    [asset.path,model], [body.path,bodyBytes], ['static-publication-index.json',indexBytes],
  ] as const;
  const manifest = json({format:'exhibitos-static-publication-v1',publicationId,revisionSha256,indexSha256,
    files:files.map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),
  });
  await mkdir(join(root,'data'), {recursive:true});
  for (const [path,bytes] of files) await writeFile(join(root,path),bytes);
  await writeFile(join(root,'static-export-manifest.json'),manifest);
  return localStaticPublicationSource({sourceDir:root,sourceManifestSha256:sha(manifest),indexSha256,publicationId,revisionSha256});
}

it('only a fully admitted matte portal contributes portal reflection to the ordinary receiver charts', async t => {
  const folder = await mkdtemp(join(tmpdir(),'native-indirect-portal-'));
  t.onTestFinished(() => rm(folder,{recursive:true,force:true}));
  const model = await readFile(new URL('../../../../assets/furnishings/user-authored-20261027/double-width-portal/model.glb',import.meta.url));
  const black = Buffer.from(model);
  const factor = /"baseColorFactor":\[[0-9.,\s]+\]/.exec(model.toString('utf8',20,20+model.readUInt32LE(12)));
  const factorOffset = factor && model.indexOf(factor[0],20);
  if (!factor || factorOffset === null || factorOffset < 20) throw Error('Missing portal diffuse material');
  black.write('"baseColorFactor":[0,0,0,1]'.padEnd(factor[0].length),factorOffset);
  const {exhibition:base} = await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')));
  const lightId = randomUUID();
  async function candidate(bytes: Buffer) {
    const model = {sha256:sha(bytes),bytes:bytes.length,mime:'model/gltf-binary' as const};
    const geometry = await validateWorkspaceFurnishingGlb(model,bytes,{},'modular-portal-v1');
    const descriptor = {id:furnishingId,version:1,kind:'portal-finish',name:'Double-width matte portal',provenance:'ExhibitOS curated CC0 original',
      rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,export:true,download:true,commercial:true}},
      model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry}};
    return {
      ...base, rooms:[room],surfaces,placements:[],artworks:[],
      openings:[{id:openingId,surfaceId:portalWall.id,type:'door',dimensions:{width:2.4,height:2.6},offset:[0,-.2]}],
      lights:[{id:lightId,roomId,type:'area',unit:'lumen',color:[1,1,1],intensity:80,castsShadow:false,
        dimensions:{width:.5,height:.5},transform:{position:[0,2.85,-.7],rotation:[-q,0,0,q],scale:[1,1,1]}}],
      extensions:{
        'org.exhibitos.studio/space-lighting':spaceLighting,
        'org.exhibitos.studio/light-details':{version:1,lights:[{lightId,fixture:'none',purpose:'room-base',basePlacement:'manual'}]},
        'org.exhibitos.studio/materials':{version:1,surfaces:Object.fromEntries(surfaces.map(surface=>[
          surface.id,{color:surface===floor?'#808080':'#000000',metalness:0,roughness:.8},
        ]))},
        [WORKSPACE_FURNISHING_NAMESPACE]:{version:7,furnishings:[descriptor],placements:[],frameAttachments:[],
          openingAttachments:[{openingId,furnishingId,furnishingVersion:1,modelSha256:model.sha256}]},
      },
    } satisfies Exhibition;
  }
  const recipeRoot = join(folder,'recipe');
  const workerPath = join(recipeRoot,roomIndirectPortalWorkerPath);
  const markerPath = join(recipeRoot,roomIndirectRecipeMarkerPath);
  await mkdir(join(recipeRoot,'scripts'),{recursive:true});
  await mkdir(dirname(workerPath),{recursive:true});
  for (const name of roomIndirectRecipeScripts) {
    const bytes = await readFile(new URL(`../../../../scripts/${name}`,import.meta.url));
    await writeFile(join(recipeRoot,'scripts',name),bytes);
  }
  // The source witness uses the actual TS adapter below, not a packaged CPU build.
  const sourceWorker = await readFile(new URL('./room-indirect-portal.ts',import.meta.url));
  await writeFile(workerPath,sourceWorker);
  const bareRecipe = await readRoomIndirectRecipe(recipeRoot);
  const portalRecipe = await readRoomIndirectRecipe(recipeRoot,true);
  expect(bareRecipe.digests).toEqual(portalRecipe.digests.slice(0,2));
  expect(portalRecipe.digests[2]).toBe(sha(sourceWorker));
  let portalLoads = 0;
  async function bake(name: string, exhibition: Exhibition, bytes: Buffer, missing = false) {
    const source = await stage(join(folder,name),exhibition,bytes);
    const indexBytes = await source.read('static-publication-index.json');
    const index = JSON.parse(indexBytes.toString());
    const bodyBytes = await source.read(index.publication.path);
    return prepareRoomIndirect({publication:JSON.parse(bodyBytes.toString()),bodyBytes,indexBytes,
      stagedAssets:{assets:missing?[]:index.assets,read:source.read}},
    {
      readRecipe:()=>readInstalledRoomIndirectRecipe(recipeRoot),
      async loadPortal(expectedSha256){
        portalLoads++;
        expect(expectedSha256).toBe(sha(sourceWorker));
        return openRoomIndirectPortal;
      },
    });
  }
  function bakedRoom(output: Awaited<ReturnType<typeof bake>>, expectedRecipe: Recipe) {
    expect(output.status).toBe('baked');
    if(output.status!=='baked')throw Error('Expected a complete room bake');
    const descriptor = JSON.parse(output.files.get(`data/${output.descriptorSha256}.json`)!.toString());
    expect(descriptor.recipe.sha256).toBe(expectedRecipe.sha256);
    expect(descriptor.rooms).toHaveLength(1);
    expect(descriptor.rooms[0].charts).toHaveLength(6);
    const chart = descriptor.rooms[0].charts.find((entry:{surfaceId:string})=>entry.surfaceId===floor.id);
    return output.files.get(`data/${chart.texture.sha256}.bin`)!.filter((_,i)=>i%4!==3);
  }
  const whiteScene=await candidate(model),blackScene=await candidate(black);
  const bare = {
    ...whiteScene,openings:[],extensions:Object.fromEntries(Object.entries(whiteScene.extensions)
      .filter(([namespace])=>namespace!==WORKSPACE_FURNISHING_NAMESPACE)),
  };
  bakedRoom(await bake('bare-two',bare,model), bareRecipe);
  expect(await bake('unapproved-worker',whiteScene,model)).toEqual({status:'live-fallback'});
  expect(portalLoads).toBe(0);
  await writeFile(markerPath,json(portalRecipe));
  bakedRoom(await bake('bare-three',bare,model), portalRecipe);
  expect(portalLoads).toBe(0);
  expect(bakedRoom(await bake('white',whiteScene,model),portalRecipe).some(value=>value>0)).toBe(true);
  expect(bakedRoom(await bake('black',blackScene,black),portalRecipe).every(value=>value===0)).toBe(true);
  expect(await bake('missing',whiteScene,model,true)).toEqual({status:'live-fallback'});
  const unsupported = {...whiteScene,extensions:{...whiteScene.extensions,'org.exhibitos.studio/architectural-finishes':{version:1,walls:[]}}};
  expect(await bake('unsupported',unsupported,model)).toEqual({status:'live-fallback'});
  await writeFile(workerPath,'stale worker');
  const previousLoads = portalLoads;
  expect(await bake('stale-worker',whiteScene,model)).toEqual({status:'live-fallback'});
  expect(portalLoads).toBe(previousLoads);
},15_000);
