// SPDX-License-Identifier: AGPL-3.0-or-later
import {CURRENT_WORKSPACE_RAIL_OEX_FORMAT} from './oex-file-format.ts';
import {runOwnedOexMaterializer} from './oex-owned-chunk-materializer.ts';

try{await runOwnedOexMaterializer(CURRENT_WORKSPACE_RAIL_OEX_FORMAT);}catch{process.exitCode=1;}
