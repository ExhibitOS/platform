// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';

export const CURRENT_WORKSPACE_RAIL_MIGRATION:string;
export const CURRENT_WORKSPACE_RAIL_SHA256:string;
export const CURRENT_WORKSPACE_RAIL_PARENT_SHA256:string;
export function assertExactCurrentWorkspaceRailCatalog(client:Pick<PoolClient,'query'>):Promise<void>;
