// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';

export function assertExactBenchBaseColorCatalog(client: PoolClient): Promise<void>;

export const BENCH_BASECOLOR_MIGRATION: '052_workspace_bench_basecolor_preparation.sql';
export const BENCH_BASECOLOR_SHA256: string;
