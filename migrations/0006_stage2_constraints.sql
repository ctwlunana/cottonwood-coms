ALTER TABLE checklist_answers ADD CONSTRAINT checklist_answers_mr_fk FOREIGN KEY (maintenance_request_id) REFERENCES maintenance_requests(id);
--> statement-breakpoint
ALTER TABLE maintenance_requests ADD CONSTRAINT mr_checklist_answer_fk FOREIGN KEY (checklist_answer_id) REFERENCES checklist_answers(id);
--> statement-breakpoint
ALTER TABLE maintenance_requests ADD CONSTRAINT mr_work_order_fk FOREIGN KEY (work_order_id) REFERENCES work_orders(id);
--> statement-breakpoint
-- Segregation of duties: the engineer who did the work cannot verify it.
ALTER TABLE work_orders ADD CONSTRAINT wo_verifier_not_assignee CHECK (verified_by IS NULL OR assigned_to IS NULL OR verified_by <> assigned_to);
--> statement-breakpoint
ALTER TABLE work_orders ADD CONSTRAINT wo_costs_nonneg CHECK ((estimated_cost IS NULL OR estimated_cost >= 0) AND (actual_cost IS NULL OR actual_cost >= 0));
--> statement-breakpoint
ALTER TABLE work_order_materials ADD CONSTRAINT wom_qty_pos CHECK (quantity > 0 AND (unit_cost IS NULL OR unit_cost >= 0));
--> statement-breakpoint
ALTER TABLE pm_schedules ADD CONSTRAINT pm_interval_pos CHECK (interval_days BETWEEN 1 AND 3650);
--> statement-breakpoint
-- A villa can only be "ready" through a passing inspection recorded for that assignment.
CREATE OR REPLACE FUNCTION coms_hk_ready_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('ready', 'cleaning_completed', 'inspection_required') THEN
    RAISE EXCEPTION 'Penugasan baru tidak boleh langsung berstatus %', NEW.status;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
    -- only from 'inspection_required', and only when the latest inspection (DB clock) passed
    IF OLD.status <> 'inspection_required' OR
       (SELECT i.result FROM hk_inspections i WHERE i.assignment_id = NEW.id ORDER BY i.at DESC LIMIT 1) IS DISTINCT FROM 'pass' THEN
      RAISE EXCEPTION 'Villa hanya dapat berstatus Siap melalui inspeksi yang lulus';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER hk_ready_guard BEFORE INSERT OR UPDATE ON hk_assignments FOR EACH ROW EXECUTE FUNCTION coms_hk_ready_guard();
