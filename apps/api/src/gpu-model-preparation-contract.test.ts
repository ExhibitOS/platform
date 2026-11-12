// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {GPU_MODEL_PREPARATION_PROFILE,GPU_MODEL_PREPARATION_PURPOSE,GPU_MODEL_PREPARATION_RECIPE,GPU_MODEL_PREPARATION_RECIPE_JSON,
 GPU_MODEL_PREPARATION_RECIPE_SHA256,GPU_MODEL_PREPARATION_LEGACY_RECIPE,GPU_MODEL_PREPARATION_LEGACY_RECIPE_JSON,GPU_MODEL_PREPARATION_LEGACY_RECIPE_SHA256,GPU_MODEL_PREPARATION_VENDOR_RECIPE,GPU_MODEL_PREPARATION_VENDOR_RECIPE_SHA256,parseGpuModelPreparationInput,bindGpuModelPreparationIntent,parseGpuModelPreparationIntent,
 gpuModelPreparationIntentSHA256} from './gpu-model-preparation-contract.ts';

const request=()=>({revision:2,assetId:'A0000000-0000-4000-8000-000000000001',sha256:'a'.repeat(64),bytes:2000000,
 idempotencyKey:'GPU.operation-1',generation:'InstalledGeneration_1',profile:GPU_MODEL_PREPARATION_PROFILE});
const binding=()=>({tenantId:'B0000000-0000-4000-8000-000000000002',principalId:'C0000000-0000-4000-8000-000000000003',
 artworkId:'D0000000-0000-4000-8000-000000000004',approvalSHA256:'b'.repeat(64),rightsSHA256:'c'.repeat(64)});

it('pins the complete canonical mipmapped recipe without private artifact dependencies or readiness claims',()=>{
 expect(createHash('sha256').update(GPU_MODEL_PREPARATION_RECIPE_JSON).digest('hex')).toBe('82a7dd855788e590ba6698f1c3c5fc51b7638edd24c891391b20c20c09ac1fdf');
 expect(GPU_MODEL_PREPARATION_RECIPE_SHA256).toBe('82a7dd855788e590ba6698f1c3c5fc51b7638edd24c891391b20c20c09ac1fdf');
 expect(GPU_MODEL_PREPARATION_RECIPE).toMatchObject({version:3,encoder:{sha256:'4ec0c7fa5f123e91f8e2adb21c1b94e7119a0f396f11cc8fd747459b2a51620c',librarySHA256:'e2f8115a77cf2c1e375210d3687f487a4e54f0cde803060cb1c4085427f3d393',bytes:993520,libraryBytes:2454960,etcUnpack:false,build:'source-noetc-v1'}});
 expect(createHash('sha256').update(GPU_MODEL_PREPARATION_LEGACY_RECIPE_JSON).digest('hex')).toBe(GPU_MODEL_PREPARATION_LEGACY_RECIPE_SHA256);
 expect(GPU_MODEL_PREPARATION_LEGACY_RECIPE).toMatchObject({version:2});
 expect(GPU_MODEL_PREPARATION_LEGACY_RECIPE.encoder.options).toContain('--wmode');
 expect(GPU_MODEL_PREPARATION_LEGACY_RECIPE_SHA256).toBe('886e3815a386a46462e46d35ccb640498ebefcc853cefba61f76560b62cae4bc');
 expect(GPU_MODEL_PREPARATION_VENDOR_RECIPE_SHA256).toBe('6739a173b5a3af38f3fb02b250a2fa4d3315972f62ea8592f1c5695ab5848d98');
 expect(GPU_MODEL_PREPARATION_VENDOR_RECIPE.encoder.sha256).toBe('708e94078c8b8a8096f3573e2899bf08fbcf702d92bbbac47bd2098a1aaa6eb6');
 expect(GPU_MODEL_PREPARATION_VENDOR_RECIPE.encoder.librarySHA256).toBe('bd26f0747b7a800384b7b3c9221dafeb3943ef565a560ab98238cade597c0947');
 expect(JSON.parse(GPU_MODEL_PREPARATION_RECIPE_JSON)).toEqual(GPU_MODEL_PREPARATION_RECIPE);
 expect(GPU_MODEL_PREPARATION_RECIPE_JSON.endsWith('\n')).toBe(false);
 expect(GPU_MODEL_PREPARATION_RECIPE.encoder.options).toContain('--genmipmap');
 expect(GPU_MODEL_PREPARATION_RECIPE.output).toMatchObject({levels:10,dimensions:[512,256,128,64,32,16,8,4,2,1],required:false,normal:'byte-identical-png',occlusion:'byte-identical-png'});
 expect(Object.isFrozen(GPU_MODEL_PREPARATION_RECIPE.encoder.options)).toBe(true);
 expect(Object.isFrozen(GPU_MODEL_PREPARATION_RECIPE.input.baseColor)).toBe(true);
});

it('accepts only the explicit seven-field request and canonicalizes UUID case alone',()=>{
 const raw=request(),parsed=parseGpuModelPreparationInput(raw);
 expect(parsed).toEqual({...raw,assetId:raw.assetId.toLowerCase()});expect(parsed).not.toBe(raw);expect(Object.isFrozen(parsed)).toBe(true);
 expect(parsed.idempotencyKey).toBe('GPU.operation-1');expect(parsed.generation).toBe('InstalledGeneration_1');
 for(const change of [{revision:1,bytes:28},{revision:2147483647,bytes:33554432},{idempotencyKey:'a'.repeat(128),generation:'9'}])expect(()=>parseGpuModelPreparationInput({...raw,...change})).not.toThrow();
 const {profile,...oldOmittedProfile}=raw;void profile;
 expect(()=>parseGpuModelPreparationInput(oldOmittedProfile)).toThrow('INVALID_GPU_MODEL_PREPARATION');
});

it('refuses coercion, out-of-bound numbers, malformed hashes/UUIDs/tokens and profile aliases',()=>{
 for(const change of [
  {revision:0},{revision:-1},{revision:1.1},{revision:2147483648},{revision:Number.NaN},{revision:Number.POSITIVE_INFINITY},{revision:'2'},
  {bytes:27},{bytes:33554433},{bytes:100.5},{bytes:Number.NEGATIVE_INFINITY},{bytes:Number.NaN},{bytes:'28'},
  {assetId:'urn:uuid:a0000000-0000-4000-8000-000000000001'},{assetId:'a0000000000040008000000000000001'},{assetId:1},
  {sha256:'A'.repeat(64)},{sha256:'a'.repeat(63)},{sha256:'a'.repeat(64)+'\n'},{sha256:1},
  {idempotencyKey:''},{idempotencyKey:'a'.repeat(129)},{idempotencyKey:' key'},{idempotencyKey:'a\nb'},{idempotencyKey:'a/b'},{generation:'A '},{generation:1},
  {profile:'embedded-model-compact-20k-512-v1'},{profile:' '+GPU_MODEL_PREPARATION_PROFILE},{profile:undefined},
 ])expect(()=>parseGpuModelPreparationInput({...request(),...change})).toThrow('INVALID_GPU_MODEL_PREPARATION');
});

it('rejects null, arrays, inherited fields, accessors, symbol keys and client-supplied authority',()=>{
 const inherited=Object.assign(Object.create({profile:GPU_MODEL_PREPARATION_PROFILE}),request());
 const accessor={...request()};Object.defineProperty(accessor,'bytes',{enumerable:true,get(){throw Error('DO_NOT_READ_ACCESSOR');}});
 const hidden={...request()};Object.defineProperty(hidden,'bytes',{value:28,enumerable:false});
 for(const value of [null,[],[request()],undefined,'request',inherited,Object.assign(Object.create(null),request()),accessor,hidden,
  {...request(),[Symbol('hidden')]:true},{...request(),profileId:GPU_MODEL_PREPARATION_PROFILE},{...request(),approvalSHA256:'b'.repeat(64)},
  {...request(),binding:binding()},JSON.parse(JSON.stringify(request()).slice(0,-1)+',"__proto__":{}}')])
  expect(()=>parseGpuModelPreparationInput(value)).toThrow('INVALID_GPU_MODEL_PREPARATION');
});

it('binds detached deeply immutable durable authority and validates every stored boundary',()=>{
 const raw=request(),owner=binding(),intent=bindGpuModelPreparationIntent(raw,owner);
 expect(intent).toMatchObject({version:1,purpose:GPU_MODEL_PREPARATION_PURPOSE,recipeSHA256:GPU_MODEL_PREPARATION_LEGACY_RECIPE_SHA256,
  request:{assetId:raw.assetId.toLowerCase()},binding:{tenantId:owner.tenantId.toLowerCase(),approvalSHA256:owner.approvalSHA256}});
 raw.generation='later';owner.rightsSHA256='d'.repeat(64);expect(intent.request.generation).toBe('InstalledGeneration_1');expect(intent.binding.rightsSHA256).toBe('c'.repeat(64));
 expect([intent,intent.request,intent.binding].every(Object.isFrozen)).toBe(true);
 const parsed=parseGpuModelPreparationIntent(intent);expect(parsed).toEqual(intent);expect(parsed).not.toBe(intent);expect(parsed.request).not.toBe(intent.request);
 for(const change of [{version:2},{purpose:'approved-full-compact'},{recipeSHA256:GPU_MODEL_PREPARATION_VENDOR_RECIPE_SHA256},{recipeSHA256:'d'.repeat(64)},{extra:true},{binding:{...binding(),sourceApprovalSHA256:'b'.repeat(64)}},
  {request:{...request(),bytes:Number.NaN}},{binding:{...binding(),rightsSHA256:'C'.repeat(64)}},{binding:{...binding(),tenantId:'alien'}},{binding:null}])
  expect(()=>parseGpuModelPreparationIntent({...intent,...change})).toThrow('GPU_MODEL_PREPARATION_INTENT_INVALID');
 expect(()=>bindGpuModelPreparationIntent(request(),{...binding(),approvalSHA256:null})).toThrow('GPU_MODEL_PREPARATION_INTENT_INVALID');
});

it('makes reordered/UUID-case replay identical and separates every request and server binding change',()=>{
 const intent=bindGpuModelPreparationIntent(request(),binding()),hash=gpuModelPreparationIntentSHA256(intent);
 const reordered=Object.fromEntries(Object.entries(intent).reverse());
 expect(gpuModelPreparationIntentSHA256(reordered)).toBe(hash);
 expect(gpuModelPreparationIntentSHA256({...intent,request:{...request(),assetId:request().assetId.toLowerCase()},binding:{...binding(),tenantId:binding().tenantId.toLowerCase()}})).toBe(hash);
 for(const change of [{revision:3},{assetId:'a0000000-0000-4000-8000-000000000005'},{sha256:'d'.repeat(64)},{bytes:2000001},
  {idempotencyKey:'gpu.operation-1'},{generation:'installedGeneration_1'}])
  expect(gpuModelPreparationIntentSHA256(bindGpuModelPreparationIntent({...request(),...change},binding()))).not.toBe(hash);
 for(const change of [{tenantId:'b0000000-0000-4000-8000-000000000005'},{principalId:'c0000000-0000-4000-8000-000000000005'},
  {artworkId:'d0000000-0000-4000-8000-000000000005'},{approvalSHA256:'d'.repeat(64)},{rightsSHA256:'d'.repeat(64)}])
  expect(gpuModelPreparationIntentSHA256(bindGpuModelPreparationIntent(request(),{...binding(),...change}))).not.toBe(hash);
});

it('uses the registered KTX4.4.2 wrapping option rather than the misspelled help entry',()=>{
 const options=[...GPU_MODEL_PREPARATION_RECIPE.encoder.options] as string[];
 expect(options).not.toContain('--wmode');
 expect(options.slice(options.indexOf('--wrapping'),options.indexOf('--wrapping')+2)).toEqual(['--wrapping','wrap']);
});
