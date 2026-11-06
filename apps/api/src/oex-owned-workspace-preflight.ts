// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed draft.12 child entry; Manager retains ownership and must reap the child.
import {runOwnedOexPreflight} from './oex-owned-preflight.ts';
try{await runOwnedOexPreflight(true);}catch{process.exitCode=1;}
