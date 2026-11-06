// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed draft.12 child entry; no file, reservation or commit authority is issued.
import {runOwnedPackedOexV2} from './oex-owned-packed-worker-v2.ts';
try{await runOwnedPackedOexV2(true);}catch{process.exitCode=1;}
