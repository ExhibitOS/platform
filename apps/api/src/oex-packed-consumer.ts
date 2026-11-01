// SPDX-License-Identifier: AGPL-3.0-or-later
import type {FileHandle} from 'node:fs/promises';
import {bindPackedOexManifest} from './oex-packed-manifest.ts';
import {bindPackedOexOutputs} from './oex-packed-output.ts';

/** Inactive byte consumer: the Manager must independently bind the manifest
 * hash to the actual archive and retain this exact synced output handle after
 * actual worker exit, and verify ACK receipt/attempt/generation and FD identity
 * before calling. This helper supplies no session, authority, rights,
 * reservation, process-drain or commit proof. */
export async function bindPackedOexConsumer(file:FileHandle,reply:Uint8Array,manifestBytes:Uint8Array,manifestSha256:string,capacity:number){
 const manifest=bindPackedOexManifest(manifestBytes,manifestSha256);
 const output=await bindPackedOexOutputs(file,reply,manifest,capacity);
 return Object.freeze({manifest,read:output.read});
}
