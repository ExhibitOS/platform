// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {Exhibition} from '@exhibitos/spec';

/** A selected preview is revision-scoped CMS input outside the saved draft.
 * This check only decides whether to reuse a published original snapshot. A
 * fresh projection still performs all ordinary byte/rights/receipt checks. */
export async function publicationThumbnailsCurrent(c:PoolClient,tenantId:string,publicationId:string,candidate:Exhibition){
 const artworks=new Map(candidate.artworks.map(artwork=>[artwork.id.toLowerCase(),artwork]));
 const current=(await c.query(`SELECT sel.artwork_id,sel.artwork_revision,sel.binding_id,b.source_asset_id,b.source_sha256
  FROM artwork_thumbnail_selections sel JOIN artwork_thumbnail_bindings b ON (b.tenant_id,b.id)=(sel.tenant_id,sel.binding_id)
  WHERE sel.tenant_id=$1 AND sel.artwork_id=ANY($2::uuid[])`,[tenantId,candidate.artworks.map(artwork=>artwork.id)])).rows;
 const selected=current.filter(row=>{const art=artworks.get(String(row.artwork_id).toLowerCase()),primary=art?.assets.find(asset=>asset.id===art.primaryAssetId);return art&&row.artwork_revision===art.revision&&row.source_asset_id===primary?.id&&row.source_sha256===primary?.sha256;});
 const published=(await c.query(`SELECT a.artwork_id,a.artwork_revision,b.binding_id
  FROM publication_thumbnail_bindings b JOIN publication_assets a ON (a.tenant_id,a.publication_id,a.id)=(b.tenant_id,b.publication_id,b.asset_id)
  WHERE b.tenant_id=$1 AND b.publication_id=$2`,[tenantId,publicationId])).rows;
 const tuples=(rows:typeof published)=>rows.map(row=>JSON.stringify([row.artwork_id,row.artwork_revision,row.binding_id])).sort();
 return JSON.stringify(tuples(selected))===JSON.stringify(tuples(published));
}
