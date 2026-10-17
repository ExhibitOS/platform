-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Render Free has no durable disk. Keep private dynamic objects in the same
-- transactional database; approved public artwork delivery remains on Pages.
CREATE TABLE hosted_objects (
  object_key text PRIMARY KEY,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 33554432),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$')
);
