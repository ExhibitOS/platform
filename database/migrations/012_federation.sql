-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Discovery contains operator-opted-in public metadata only, never asset bytes.
CREATE TABLE federation_identity_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 origin text NOT NULL, public_key text NOT NULL, sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0)
);
CREATE TABLE federation_listings (
 publication_id uuid PRIMARY KEY REFERENCES studio_publications(id),
 enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE federation_peers (
 origin text PRIMARY KEY, public_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('trusted','blocked')),
 sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),
 last_attempt timestamptz, last_success timestamptz,
 lease_id uuid, error_code text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE federation_cache (
 origin text NOT NULL REFERENCES federation_peers(origin), publication_id uuid NOT NULL,
 title text NOT NULL, url text NOT NULL, revision_sha256 text NOT NULL,
 published_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(origin,publication_id)
);
CREATE INDEX federation_cache_expiry ON federation_cache(expires_at);
