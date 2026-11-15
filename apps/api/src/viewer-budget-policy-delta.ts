// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {resetViewerBudgetPolicy,validateViewerBudgetPolicy} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';
/** Only per-exhibition budget metadata plus normal edit bookkeeping may change.
 * This grants no authority; the ordinary owner/CAS/source checks still apply. */
export function ordinaryViewerBudgetPolicyDelta(before:Draft,after:Draft):boolean {
 if(!validateViewerBudgetPolicy(after.candidate).valid)return false;
 const a={...structuredClone(before),candidate:resetViewerBudgetPolicy(before.candidate)},b={...structuredClone(after),candidate:resetViewerBudgetPolicy(after.candidate)};
 a.editVersion=b.editVersion;a.updatedAt=b.updatedAt;
 return isDeepStrictEqual(a,b);
}
