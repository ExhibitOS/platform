// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed draft.12 child entry; Manager retains admission, cleanup and child reap.
import {runOwnedOexMaterializer} from './oex-owned-chunk-materializer.ts';
try{await runOwnedOexMaterializer(true);}catch{process.exitCode=1;}
