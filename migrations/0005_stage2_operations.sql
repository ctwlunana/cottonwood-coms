CREATE TYPE "public"."checklist_answer" AS ENUM('yes', 'no', 'na');--> statement-breakpoint
CREATE TYPE "public"."hk_status" AS ENUM('pending', 'assigned', 'in_progress', 'cleaning_completed', 'inspection_required', 'inspection_failed', 'reclean_required', 'ready', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inspection_result" AS ENUM('pass', 'fail');--> statement-breakpoint
CREATE TYPE "public"."maintenance_category" AS ENUM('plumbing', 'electrical', 'ac', 'pool', 'garden', 'furniture', 'appliance', 'structure', 'pest', 'safety', 'other');--> statement-breakpoint
CREATE TYPE "public"."maintenance_request_status" AS ENUM('pending_review', 'converted', 'merged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."maintenance_source" AS ENUM('keeper', 'checklist', 'cs', 'supervisor', 'housekeeping', 'other');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('new', 'under_review', 'assigned', 'in_progress', 'waiting_parts', 'waiting_approval', 'completed', 'verified', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "checklist_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"section" text,
	"answer" "checklist_answer" NOT NULL,
	"note" text,
	"maintenance_request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "checklist_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"template_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"check_date" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"fail_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "checklist_submissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"section" text,
	"label" text NOT NULL,
	"category" text,
	"photo_required_on_fail" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "maintenance_category" NOT NULL,
	"brand" text,
	"model" text,
	"serial_no" text,
	"installed_on" date,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hk_assignment_staff" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hk_assignment_staff_assignment_id_user_id_pk" PRIMARY KEY("assignment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hk_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"property_id" uuid NOT NULL,
	"checkout_date" date NOT NULL,
	"expected_done_at" timestamp with time zone NOT NULL,
	"team_id" uuid,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"instructions" text,
	"status" "hk_status" DEFAULT 'pending' NOT NULL,
	"reclean_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"cleaning_completed_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hk_assignments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "hk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid,
	"from_status" "hk_status",
	"to_status" "hk_status",
	"note" text,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hk_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"inspector_id" uuid NOT NULL,
	"result" "inspection_result" NOT NULL,
	"notes" text,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hk_team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hk_team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hk_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid,
	"leader_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"property_id" uuid NOT NULL,
	"category" "maintenance_category" NOT NULL,
	"description" text NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"source" "maintenance_source" DEFAULT 'keeper' NOT NULL,
	"reported_by" uuid NOT NULL,
	"discovered_at" timestamp with time zone NOT NULL,
	"status" "maintenance_request_status" DEFAULT 'pending_review' NOT NULL,
	"checklist_answer_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"work_order_id" uuid,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_requests_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pm_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"equipment_id" uuid,
	"title" text NOT NULL,
	"category" "maintenance_category" NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"last_done_on" date,
	"default_assignee_id" uuid,
	"instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(15, 0),
	"recorded_by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"from_status" "work_order_status",
	"to_status" "work_order_status",
	"note" text,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"property_id" uuid NOT NULL,
	"request_id" uuid,
	"pm_schedule_id" uuid,
	"equipment_id" uuid,
	"category" "maintenance_category" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"status" "work_order_status" DEFAULT 'new' NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"supervisor_id" uuid,
	"assigned_to" uuid,
	"vendor_name" text,
	"deadline" timestamp with time zone,
	"estimated_cost" numeric(15, 0),
	"actual_cost" numeric(15, 0),
	"findings" text,
	"repair_notes" text,
	"keeper_confirmation_required" boolean DEFAULT false NOT NULL,
	"repeat_issue" boolean DEFAULT false NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"keeper_confirmed_at" timestamp with time zone,
	"keeper_confirmed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "checklist_answers" ADD CONSTRAINT "checklist_answers_submission_id_checklist_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."checklist_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_answers" ADD CONSTRAINT "checklist_answers_item_id_checklist_template_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_template_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_submissions" ADD CONSTRAINT "checklist_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignment_staff" ADD CONSTRAINT "hk_assignment_staff_assignment_id_hk_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."hk_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignment_staff" ADD CONSTRAINT "hk_assignment_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignment_staff" ADD CONSTRAINT "hk_assignment_staff_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignments" ADD CONSTRAINT "hk_assignments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignments" ADD CONSTRAINT "hk_assignments_team_id_hk_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."hk_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_assignments" ADD CONSTRAINT "hk_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_events" ADD CONSTRAINT "hk_events_assignment_id_hk_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."hk_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_events" ADD CONSTRAINT "hk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_inspections" ADD CONSTRAINT "hk_inspections_assignment_id_hk_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."hk_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_inspections" ADD CONSTRAINT "hk_inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_team_members" ADD CONSTRAINT "hk_team_members_team_id_hk_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."hk_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_team_members" ADD CONSTRAINT "hk_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_teams" ADD CONSTRAINT "hk_teams_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hk_teams" ADD CONSTRAINT "hk_teams_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_updates" ADD CONSTRAINT "work_order_updates_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_updates" ADD CONSTRAINT "work_order_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_pm_schedule_id_pm_schedules_id_fk" FOREIGN KEY ("pm_schedule_id") REFERENCES "public"."pm_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_keeper_confirmed_by_users_id_fk" FOREIGN KEY ("keeper_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_answers_sub_idx" ON "checklist_answers" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "checklist_sub_property_date_idx" ON "checklist_submissions" USING btree ("property_id","check_date");--> statement-breakpoint
CREATE INDEX "checklist_sub_user_idx" ON "checklist_submissions" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "checklist_items_template_idx" ON "checklist_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "equipment_property_idx" ON "equipment" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "hk_staff_user_idx" ON "hk_assignment_staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hk_property_date_idx" ON "hk_assignments" USING btree ("property_id","checkout_date");--> statement-breakpoint
CREATE INDEX "hk_status_idx" ON "hk_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hk_date_idx" ON "hk_assignments" USING btree ("checkout_date");--> statement-breakpoint
CREATE INDEX "hk_events_assignment_idx" ON "hk_events" USING btree ("assignment_id","at");--> statement-breakpoint
CREATE INDEX "hk_inspections_assignment_idx" ON "hk_inspections" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "mr_status_idx" ON "maintenance_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mr_property_idx" ON "maintenance_requests" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mr_checklist_answer_unique" ON "maintenance_requests" USING btree ("checklist_answer_id") WHERE checklist_answer_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pm_due_idx" ON "pm_schedules" USING btree ("is_active","next_due_on");--> statement-breakpoint
CREATE INDEX "wo_materials_wo_idx" ON "work_order_materials" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "wo_updates_wo_idx" ON "work_order_updates" USING btree ("work_order_id","at");--> statement-breakpoint
CREATE INDEX "wo_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wo_property_idx" ON "work_orders" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "wo_assignee_idx" ON "work_orders" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "wo_deadline_idx" ON "work_orders" USING btree ("deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "wo_pm_open_unique" ON "work_orders" USING btree ("pm_schedule_id") WHERE pm_schedule_id IS NOT NULL AND status NOT IN ('closed','cancelled');