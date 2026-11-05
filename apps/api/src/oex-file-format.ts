// SPDX-License-Identifier: AGPL-3.0-or-later
export const NATIVE_OEX_FILE_FORMATS=['1.0.0-draft.9','1.0.0-draft.10'] as const;
export type NativeOexFileFormat=typeof NATIVE_OEX_FILE_FORMATS[number];
export function isNativeOexFileFormat(value:unknown):value is NativeOexFileFormat {
 return value==='1.0.0-draft.9'||value==='1.0.0-draft.10';
}
/** The catalogue wire version alone does not declare a bounded archive. */
export function isNativeOexFileManifest(value:unknown):value is Record<string,unknown>&{formatVersion:NativeOexFileFormat}{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const m=value as Record<string,unknown>;
 return m.formatVersion==='1.0.0-draft.9'&&m.archiveProfile===undefined||m.formatVersion==='1.0.0-draft.10'&&m.archiveProfile==='bounded-file-v1';
}
