import type {PoolClient} from 'pg';
// SPDX-License-Identifier: AGPL-3.0-or-later
export const HAYES_PREOPEN_TERMINAL_MIGRATION:string;
export const HAYES_PREOPEN_TERMINAL_SHA256:string;

export const BENCH_AFTER_TERMINAL_MIGRATION:string;
export const BENCH_AFTER_TERMINAL_SHA256:string;
export function assertExactBenchAfterTerminalCatalog(client:Pick<PoolClient,'query'>):Promise<void>;
