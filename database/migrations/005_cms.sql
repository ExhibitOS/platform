CREATE TABLE artist_revisions(tenant_id uuid,artist_id uuid,revision integer NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,artist_id,revision),FOREIGN KEY(tenant_id,artist_id) REFERENCES artists(tenant_id,id));
INSERT INTO artist_revisions(tenant_id,artist_id,revision,snapshot) SELECT tenant_id,id,revision,jsonb_build_object('name',metadata->'name','bio',metadata->'bio','userId',user_id) FROM artists;
CREATE TRIGGER artist_snapshot_immutable BEFORE UPDATE OR DELETE ON artist_revisions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
ALTER TABLE artworks ADD COLUMN cms_managed boolean NOT NULL DEFAULT false;
ALTER TABLE artworks ADD COLUMN approved_revision integer,ADD COLUMN approved_asset_id uuid,ADD FOREIGN KEY(tenant_id,approved_asset_id) REFERENCES assets(tenant_id,id);
CREATE TABLE artwork_approvals(tenant_id uuid,artwork_id uuid,revision integer,asset_id uuid NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,artwork_id,revision),FOREIGN KEY(tenant_id,artwork_id,revision) REFERENCES artwork_revisions(tenant_id,artwork_id,revision),FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id));
CREATE TRIGGER artwork_approval_immutable BEFORE UPDATE OR DELETE ON artwork_approvals FOR EACH ROW EXECUTE FUNCTION immutable_revision();
