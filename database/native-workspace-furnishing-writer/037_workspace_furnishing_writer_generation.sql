-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Opt-in fresh catalog only. Existing 036 owners and unknown live claims are
-- never migrated by ordinary open; a retained claim without identity fails.
ALTER TABLE workspace_furnishing_intakes
 ADD COLUMN worker_generation uuid,
 ADD COLUMN worker_root_device numeric(20,0),
 ADD COLUMN worker_root_inode numeric(20,0),
 ADD COLUMN worker_lock_device numeric(20,0),
 ADD COLUMN worker_lock_inode numeric(20,0),
 ADD CONSTRAINT workspace_furnishing_worker_identity CHECK (
  (worker_token IS NULL AND worker_generation IS NULL AND worker_root_device IS NULL AND worker_root_inode IS NULL AND worker_lock_device IS NULL AND worker_lock_inode IS NULL)
  OR
  (worker_token IS NOT NULL AND worker_generation IS NOT NULL
   AND worker_root_device IS NOT NULL AND worker_root_inode IS NOT NULL
   AND worker_lock_device IS NOT NULL AND worker_lock_inode IS NOT NULL
   AND worker_root_device BETWEEN 0 AND 18446744073709551615
   AND worker_root_inode BETWEEN 1 AND 18446744073709551615
   AND worker_lock_device BETWEEN 0 AND 18446744073709551615
   AND worker_lock_inode BETWEEN 1 AND 18446744073709551615)
 );
