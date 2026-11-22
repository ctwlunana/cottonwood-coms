import {
  pgTable, uuid, text, boolean, timestamp, integer, pgEnum, numeric, date, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, properties, locations, priorityEnum } from "./core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const timestamps = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
};
const money = (name: string) => numeric(name, { precision: 15, scale: 0 });

// ================================================================ checklists
export const checklistAnswerEnum = pgEnum("checklist_answer", ["yes", "no", "na"]);

export const checklistTemplates = pgTable("checklist_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const checklistTemplateItems = pgTable("checklist_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => checklistTemplates.id),
  section: text("section"),
  label: text("label").notNull(),
  /** maintenance category suggested when this item fails */
  category: text("category"),
  photoRequiredOnFail: boolean("photo_required_on_fail").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [index("checklist_items_template_idx").on(t.templateId)]);

export const checklistSubmissions = pgTable("checklist_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  templateId: uuid("template_id").notNull().references(() => checklistTemplates.id),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  /** operational date (Asia/Jakarta) the checklist belongs to */
  checkDate: date("check_date", { mode: "string" }).notNull(),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  notes: text("notes"),
  failCount: integer("fail_count").notNull().default(0),
}, (t) => [
  index("checklist_sub_property_date_idx").on(t.propertyId, t.checkDate),
  index("checklist_sub_user_idx").on(t.submittedBy),
]);

export const checklistAnswers = pgTable("checklist_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => checklistSubmissions.id),
  itemId: uuid("item_id").notNull().references(() => checklistTemplateItems.id),
  /** label snapshot so later template edits never rewrite history */
  label: text("label").notNull(),
  section: text("section"),
  answer: checklistAnswerEnum("answer").notNull(),
  note: text("note"),
  maintenanceRequestId: uuid("maintenance_request_id"),
}, (t) => [index("checklist_answers_sub_idx").on(t.submissionId)]);

// ================================================================ maintenance
export const maintenanceCategoryEnum = pgEnum("maintenance_category", [
  "plumbing", "electrical", "ac", "pool", "garden", "furniture", "appliance", "structure", "pest", "safety", "other",
]);
export const maintenanceRequestStatusEnum = pgEnum("maintenance_request_status", [
  "pending_review", "converted", "merged", "rejected",
]);
export const maintenanceSourceEnum = pgEnum("maintenance_source", ["keeper", "checklist", "cs", "supervisor", "housekeeping", "other"]);
export const workOrderStatusEnum = pgEnum("work_order_status", [
  "new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval",
  "completed", "verified", "closed", "cancelled",
]);

export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  name: text("name").notNull(),
  category: maintenanceCategoryEnum("category").notNull(),
  brand: text("brand"),
  model: text("model"),
  serialNo: text("serial_no"),
  installedOn: date("installed_on", { mode: "string" }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [index("equipment_property_idx").on(t.propertyId)]);

export const pmSchedules = pgTable("pm_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  equipmentId: uuid("equipment_id").references(() => equipment.id),
  title: text("title").notNull(),
  category: maintenanceCategoryEnum("category").notNull(),
  intervalDays: integer("interval_days").notNull(),
  nextDueOn: date("next_due_on", { mode: "string" }).notNull(),
  lastDoneOn: date("last_done_on", { mode: "string" }),
  defaultAssigneeId: uuid("default_assignee_id").references(() => users.id),
  instructions: text("instructions"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
}, (t) => [index("pm_due_idx").on(t.isActive, t.nextDueOn)]);

export const maintenanceRequests = pgTable("maintenance_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  category: maintenanceCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  priority: priorityEnum("priority").notNull().default("normal"),
  source: maintenanceSourceEnum("source").notNull().default("keeper"),
  reportedBy: uuid("reported_by").notNull().references(() => users.id),
  discoveredAt: ts("discovered_at").notNull(),
  status: maintenanceRequestStatusEnum("status").notNull().default("pending_review"),
  /** set when created from a failed checklist item */
  checklistAnswerId: uuid("checklist_answer_id"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  reviewNote: text("review_note"),
  workOrderId: uuid("work_order_id"),
  repeatCount: integer("repeat_count").notNull().default(0),
  ...timestamps,
}, (t) => [
  index("mr_status_idx").on(t.status),
  index("mr_property_idx").on(t.propertyId),
  uniqueIndex("mr_checklist_answer_unique").on(t.checklistAnswerId).where(sql`checklist_answer_id IS NOT NULL`),
]);

export const workOrders = pgTable("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  requestId: uuid("request_id").references(() => maintenanceRequests.id),
  pmScheduleId: uuid("pm_schedule_id").references(() => pmSchedules.id),
  equipmentId: uuid("equipment_id").references(() => equipment.id),
  category: maintenanceCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: priorityEnum("priority").notNull().default("normal"),
  status: workOrderStatusEnum("status").notNull().default("new"),
  reportedBy: uuid("reported_by").notNull().references(() => users.id),
  reportedAt: ts("reported_at").notNull(),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  assignedTo: uuid("assigned_to").references(() => users.id),
  vendorName: text("vendor_name"),
  deadline: ts("deadline"),
  estimatedCost: money("estimated_cost"),
  actualCost: money("actual_cost"),
  findings: text("findings"),
  repairNotes: text("repair_notes"),
  keeperConfirmationRequired: boolean("keeper_confirmation_required").notNull().default(false),
  repeatIssue: boolean("repeat_issue").notNull().default(false),
  assignedAt: ts("assigned_at"),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  verifiedAt: ts("verified_at"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  keeperConfirmedAt: ts("keeper_confirmed_at"),
  keeperConfirmedBy: uuid("keeper_confirmed_by").references(() => users.id),
  closedAt: ts("closed_at"),
  cancelledReason: text("cancelled_reason"),
  ...timestamps,
}, (t) => [
  index("wo_status_idx").on(t.status),
  index("wo_property_idx").on(t.propertyId),
  index("wo_assignee_idx").on(t.assignedTo),
  index("wo_deadline_idx").on(t.deadline),
  // at most one open generated WO per preventive schedule
  uniqueIndex("wo_pm_open_unique").on(t.pmScheduleId).where(sql`pm_schedule_id IS NOT NULL AND status NOT IN ('closed','cancelled')`),
]);

export const workOrderUpdates = pgTable("work_order_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
  userId: uuid("user_id").references(() => users.id),
  kind: text("kind").notNull(), // status | comment | assignment | priority | material | cost
  fromStatus: workOrderStatusEnum("from_status"),
  toStatus: workOrderStatusEnum("to_status"),
  note: text("note"),
  at: ts("at").notNull().default(sql`clock_timestamp()`),
}, (t) => [index("wo_updates_wo_idx").on(t.workOrderId, t.at)]);

export const workOrderMaterials = pgTable("work_order_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  unitCost: money("unit_cost"),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("wo_materials_wo_idx").on(t.workOrderId)]);

// ================================================================ housekeeping
export const hkStatusEnum = pgEnum("hk_status", [
  "pending", "assigned", "in_progress", "cleaning_completed", "inspection_required",
  "inspection_failed", "reclean_required", "ready", "cancelled",
]);
export const inspectionResultEnum = pgEnum("inspection_result", ["pass", "fail"]);

export const hkTeams = pgTable("hk_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  locationId: uuid("location_id").references(() => locations.id),
  leaderId: uuid("leader_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
});

export const hkTeamMembers = pgTable("hk_team_members", {
  teamId: uuid("team_id").notNull().references(() => hkTeams.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  addedAt: ts("added_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] })]);

export const hkAssignments = pgTable("hk_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  checkoutDate: date("checkout_date", { mode: "string" }).notNull(),
  expectedDoneAt: ts("expected_done_at").notNull(),
  teamId: uuid("team_id").references(() => hkTeams.id),
  priority: priorityEnum("priority").notNull().default("normal"),
  instructions: text("instructions"),
  status: hkStatusEnum("status").notNull().default("pending"),
  recleanCount: integer("reclean_count").notNull().default(0),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  startedAt: ts("started_at"),
  cleaningCompletedAt: ts("cleaning_completed_at"),
  readyAt: ts("ready_at"),
  cancelledReason: text("cancelled_reason"),
  ...timestamps,
}, (t) => [
  index("hk_property_date_idx").on(t.propertyId, t.checkoutDate),
  index("hk_status_idx").on(t.status),
  index("hk_date_idx").on(t.checkoutDate),
]);

export const hkAssignmentStaff = pgTable("hk_assignment_staff", {
  assignmentId: uuid("assignment_id").notNull().references(() => hkAssignments.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  assignedBy: uuid("assigned_by").references(() => users.id),
  assignedAt: ts("assigned_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.assignmentId, t.userId] }), index("hk_staff_user_idx").on(t.userId)]);

export const hkInspections = pgTable("hk_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").notNull().references(() => hkAssignments.id),
  inspectorId: uuid("inspector_id").notNull().references(() => users.id),
  result: inspectionResultEnum("result").notNull(),
  notes: text("notes"),
  at: ts("at").notNull().default(sql`clock_timestamp()`),
}, (t) => [index("hk_inspections_assignment_idx").on(t.assignmentId)]);

export const hkEvents = pgTable("hk_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").notNull().references(() => hkAssignments.id),
  userId: uuid("user_id").references(() => users.id),
  fromStatus: hkStatusEnum("from_status"),
  toStatus: hkStatusEnum("to_status"),
  note: text("note"),
  at: ts("at").notNull().default(sql`clock_timestamp()`),
}, (t) => [index("hk_events_assignment_idx").on(t.assignmentId, t.at)]);
