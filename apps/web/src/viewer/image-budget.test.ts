// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {syntheticArtwork} from '../placement/model';
import {AssetPeakBudget,DEVICE_BUDGETS,assetDecodeReserve,textureResidentBytes} from './loading';
import {resizeArtworkBitmap} from './image-budget';
afterEach(()=>vi.unstubAllGlobals());
it('reserves a large image beside an existing furnishing and decodes to the same bounded size',async()=>{
 const artwork=syntheticArtwork('image'),asset=artwork.assets[0]!,header=new ArrayBuffer(33),view=new DataView(header);view.setUint32(16,2048);view.setUint32(20,1024);const budget={...DEVICE_BUDGETS.compact,maxTextureSize:512},ledger=new AssetPeakBudget(32*1024*1024,()=>0);ledger.reserve('furnishing',4*1024*1024);const reserve=assetDecodeReserve(artwork,asset,budget,header);ledger.reserve('artwork',reserve+1024*1024);const close=vi.fn(),bitmap={width:2048,height:1024,close} as unknown as ImageBitmap,resized={width:512,height:256,close:vi.fn()} as unknown as ImageBitmap,decode=vi.fn(async()=>resized);vi.stubGlobal('createImageBitmap',decode);const result=await resizeArtworkBitmap(bitmap,budget);expect(result).toBe(resized);expect(decode).toHaveBeenCalledWith(bitmap,expect.objectContaining({resizeWidth:512,resizeHeight:256,imageOrientation:'none'}));expect(close).toHaveBeenCalledOnce();expect(reserve).toBeGreaterThanOrEqual(textureResidentBytes(resized.width,resized.height));expect(ledger.total()).toBeGreaterThan(reserve);ledger.release('artwork');ledger.release('furnishing');expect(ledger.total()).toBe(0);
});
