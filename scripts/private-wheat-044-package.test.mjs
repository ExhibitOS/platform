// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {packageNativeRuntime} from './package-native-runtime.mjs';
const qualification='2152f40102fc904b971a66fbedacaf6a157706c507ae59cb04c4ff6a886a6082';
const selected={normalOexSelected:true,privateStaticEditor:true,workspaceMaterialSelected:true,workspaceImportSelected:true,workspaceWallImportSelected:true,workspaceFurnishingSelected:true,workspaceFurnishingWriterSelected:true,workspaceFurnishingPublicationSelected:true,workspaceMaterialPublicationSelected:true,workspaceMaterialMultimapSelected:true,workspaceFurnishingStoolSelected:true,workspaceFurnishingRoomVisualSelected:true,workspaceFurnishingArtworkFrameSelected:true,workspaceFurnishingArtworkFrameModelsSelected:true,workspaceArtworkFramePreparationSelected:true,workspacePortalFinishSelected:true,hayesOriginalSelected:true,hayesDispositionSelected:true,hayesReleaseSelected:true};
test('Wheat detail marker requires the exact qualification and selected 044 non-probe payload',async()=>{
 for(const config of [{privateWheatQualification:qualification},{...selected,privateWheatQualification:'0'.repeat(64)},{...selected,privateWheatQualification:qualification,hayesReleaseSelected:false},{...selected,privateWheatQualification:qualification,workspacePortalFinishSelected:false},{...selected,privateWheatQualification:qualification,privateStaticEditor:false},{...selected,privateWheatQualification:qualification,hayesReleaseProbeSelected:true}])await assert.rejects(packageNativeRuntime('/unused',config),/NATIVE_PACKAGE_INPUT_INVALID/);
});
