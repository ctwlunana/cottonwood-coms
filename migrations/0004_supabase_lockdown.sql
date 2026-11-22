-- Defense in depth for hosting on Supabase: the `public` schema is exposed by Supabase's
-- REST/GraphQL Data API to the `anon` and `authenticated` roles. COMS never uses that API
-- (the app connects directly as its own role), so every COMS table gets RLS enabled with
-- NO policies, and those API roles lose all privileges. Harmless on plain PostgreSQL.
-- coms_lockdown() is re-run by `npm run db:migrate` after every migration, so new tables are covered.
CREATE OR REPLACE FUNCTION coms_lockdown() RETURNS void LANGUAGE plpgsql AS $$
DECLARE t record; r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
SELECT coms_lockdown();
