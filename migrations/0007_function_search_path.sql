-- Pin search_path on COMS trigger/utility functions (Supabase advisor 0011: function_search_path_mutable).
ALTER FUNCTION coms_audit_immutable() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION coms_hk_ready_guard() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION coms_lockdown() SET search_path = public, pg_temp;
