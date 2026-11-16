// SPDX-License-Identifier: AGPL-3.0-or-later
import {runOwnedOexPreflight} from './oex-owned-preflight.ts';

try{await runOwnedOexPreflight('current-rail');}catch{process.exitCode=1;}
