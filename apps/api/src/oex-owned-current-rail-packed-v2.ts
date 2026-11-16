// SPDX-License-Identifier: AGPL-3.0-or-later
import {CURRENT_WORKSPACE_RAIL_OEX_FORMAT} from './oex-current-workspace-rail.ts';
import {runOwnedPackedOexV2} from './oex-owned-packed-worker-v2.ts';

try{await runOwnedPackedOexV2(CURRENT_WORKSPACE_RAIL_OEX_FORMAT);}catch{process.exitCode=1;}
