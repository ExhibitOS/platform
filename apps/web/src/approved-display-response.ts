// SPDX-License-Identifier: AGPL-3.0-or-later
/** A response treatment marker supplements, never replaces, current scope,
 * approval, revision/hash and bounded-content checks at each native consumer. */
export function approvedDisplayCopyResponse(headers:Pick<Headers,'get'>){
 const mime=headers.get('content-type')?.split(';')[0]?.trim();
 if(mime!=='image/png'&&mime!=='model/gltf-binary')return false;
 const copy=headers.get('x-exhibitos-display-copy'),mode=headers.get('x-exhibitos-watermark-mode'),marked=headers.get('x-exhibitos-watermarked');
 if(copy===null&&mode===null)return marked==='true'; // Existing qualified runtime.
 if(copy!=='true')return false;
 return mode==='none'&&marked==='false'||mode==='embedded'&&marked==='true'&&mime==='image/png';
}
