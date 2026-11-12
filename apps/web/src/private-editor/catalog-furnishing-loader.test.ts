// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {REFINED_BENCH} from '@exhibitos/studio-contract';
import {catalogTextureBytes} from './catalog-furnishing-loader';
it('budgets only the fixed refined embedded PNG and refuses external, oversized and out-of-bounds image descriptors',()=>{
 const bytes=new Uint8Array(24),header=new DataView(bytes.buffer);header.setUint32(0,0x89504e47);header.setUint32(4,0x0d0a1a0a);header.setUint32(12,0x49484452);header.setUint32(16,1024);header.setUint32(20,512);
 const doc={buffers:[{}],bufferViews:[{buffer:0,byteLength:24}],images:[{bufferView:0,mimeType:'image/png'}],textures:[{source:0}]};
 expect(catalogTextureBytes(REFINED_BENCH,doc,bytes,0)).toBe(6291456);expect(catalogTextureBytes({sha256:'old'}, {},bytes,0)).toBe(0);
 for(const bad of [{...doc,images:[{...doc.images[0],uri:'https://example.com/image.png'}]},{...doc,buffers:[{uri:'external.bin'}]},{...doc,bufferViews:[{buffer:0,byteLength:25}]},{...doc,images:[...doc.images,...doc.images]}])expect(()=>catalogTextureBytes(REFINED_BENCH,bad,bytes,0)).toThrow('CATALOG_PROFILE');
 expect(()=>catalogTextureBytes({sha256:'old'},doc,bytes,0)).toThrow('CATALOG_PROFILE');header.setUint32(16,2048);expect(()=>catalogTextureBytes(REFINED_BENCH,doc,bytes,0)).toThrow('CATALOG_PROFILE');
});
