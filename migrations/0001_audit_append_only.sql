-- Audit trail is append-only: block UPDATE / DELETE / TRUNCATE at the database level.
CREATE OR REPLACE FUNCTION coms_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs bersifat append-only (operasi % ditolak)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION coms_audit_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION coms_audit_immutable();
--> statement-breakpoint
-- Sanity constraints
ALTER TABLE properties ADD CONSTRAINT properties_rooms_nonneg CHECK (bedrooms >= 0 AND bathrooms >= 0);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_username_lower CHECK (username = lower(username));
