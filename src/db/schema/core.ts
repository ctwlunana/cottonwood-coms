import {
  pgTable, uuid, text, boolean, timestamp, integer, jsonb, bigserial, pgEnum,
  primaryKey, index, uniqueIndex, inet,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const timestamps = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
};

// ---------------------------------------------------------------- enums
export const scopeEnum = pgEnum("permission_scope", ["own", "assigned", "department", "all"]);
export const propertyStatusEnum = pgEnum("property_status", [
  "active", "temporarily_unavailable", "under_maintenance", "inactive",
]);
export const propertyAssignmentKindEnum = pgEnum("property_assignment_kind", [
  "villa_keeper", "inspector",
]);
export const locationAssignmentKindEnum = pgEnum("location_assignment_kind", [
  "location_pic", "hk_team_leader",
]);
export const priorityEnum = pgEnum("priority", ["critical", "high", "normal", "low"]);
export const channelEnum = pgEnum("notification_channel", ["in_app", "push"]);
export const deliveryStatusEnum = pgEnum("delivery_status", ["pending", "sent", "failed", "skipped"]);

// ---------------------------------------------------------------- organization
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeCode: text("employee_code").notNull().unique(),
  username: text("username").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  jobTitle: text("job_title"),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  departmentId: uuid("department_id").references(() => departments.id),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: ts("last_login_at"),
  passwordChangedAt: ts("password_changed_at"),
  deactivatedAt: ts("deactivated_at"),
  ...timestamps,
}, (t) => [index("users_department_idx").on(t.departmentId)]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  departmentId: uuid("department_id").references(() => departments.id),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
});

export const permissions = pgTable("permissions", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  description: text("description").notNull(),
  scoped: boolean("scoped").notNull().default(false),
  stage: integer("stage").notNull().default(1),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionCode: text("permission_code").notNull().references(() => permissions.code, { onDelete: "cascade" }),
  scope: scopeEnum("scope").notNull().default("all"),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  grantedBy: uuid("granted_by").references(() => users.id),
  grantedAt: ts("granted_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)]);

// ---------------------------------------------------------------- auth
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  issuedBy: uuid("issued_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const passwordResetRequests = pgTable("password_reset_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ip: inet("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
  handledAt: ts("handled_at"),
  handledBy: uuid("handled_by").references(() => users.id),
});

export const loginAttempts = pgTable("login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username: text("username").notNull(),
  ip: inet("ip"),
  success: boolean("success").notNull(),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("login_attempts_username_at_idx").on(t.username, t.at), index("login_attempts_ip_at_idx").on(t.ip, t.at)]);

// ---------------------------------------------------------------- locations & properties
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  area: text("area"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
});

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  address: text("address"),
  status: propertyStatusEnum("status").notNull().default("active"),
  bedrooms: integer("bedrooms").notNull().default(0),
  bathrooms: integer("bathrooms").notNull().default(0),
  maxGuests: integer("max_guests"),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  deletedAt: ts("deleted_at"),
  ...timestamps,
}, (t) => [index("properties_location_idx").on(t.locationId), index("properties_status_idx").on(t.status)]);

export const propertyAssignments = pgTable("property_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().references(() => properties.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: propertyAssignmentKindEnum("kind").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  assignedBy: uuid("assigned_by").references(() => users.id),
}, (t) => [
  index("property_assignments_user_idx").on(t.userId),
  // only one active Villa Keeper per villa
  uniqueIndex("property_assignments_one_active_keeper")
    .on(t.propertyId)
    .where(sql`kind = 'villa_keeper' AND ended_at IS NULL`),
  uniqueIndex("property_assignments_active_unique")
    .on(t.propertyId, t.userId, t.kind)
    .where(sql`ended_at IS NULL`),
]);

export const locationAssignments = pgTable("location_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: locationAssignmentKindEnum("kind").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  assignedBy: uuid("assigned_by").references(() => users.id),
}, (t) => [
  index("location_assignments_user_idx").on(t.userId),
  uniqueIndex("location_assignments_active_unique")
    .on(t.locationId, t.userId, t.kind)
    .where(sql`ended_at IS NULL`),
]);

// ---------------------------------------------------------------- attachments
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  kind: text("kind").notNull().default("photo"),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name"),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
}, (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)]);

// ---------------------------------------------------------------- audit (append-only, see migration trigger)
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_user_idx").on(t.userId),
  index("audit_at_idx").on(t.at),
]);

// ---------------------------------------------------------------- notifications
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  priority: priorityEnum("priority").notNull().default("normal"),
  dedupeKey: text("dedupe_key"),
  createdAt: ts("created_at").notNull().defaultNow(),
  readAt: ts("read_at"),
  acknowledgedAt: ts("acknowledged_at"),
}, (t) => [
  index("notifications_user_unread_idx").on(t.userId, t.readAt),
  index("notifications_dedupe_idx").on(t.userId, t.dedupeKey, t.createdAt),
]);

export const notificationDeliveryLogs = pgTable("notification_delivery_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").notNull().references(() => users.id),
  channel: channelEnum("channel").notNull(),
  status: deliveryStatusEnum("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
}, (t) => [index("delivery_status_idx").on(t.status, t.channel)]);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "*" = default for all types
  inApp: boolean("in_app").notNull().default(true),
  push: boolean("push").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.userId, t.type] })]);

// ---------------------------------------------------------------- settings & counters
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const idCounters = pgTable("id_counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ---------------------------------------------------------------- backups
export const backupKindEnum = pgEnum("backup_kind", ["database", "files"]);
export const backupLogs = pgTable("backup_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: backupKindEnum("kind").notNull(),
  trigger: text("trigger").notNull(), // "manual_download" | "scheduled"
  requestedBy: uuid("requested_by").references(() => users.id),
  storageKey: text("storage_key"), // set for scheduled backups kept in object storage
  tables: integer("tables"),
  rows: integer("rows"),
  files: integer("files"),
  sizeBytes: integer("size_bytes"),
  status: text("status").notNull().default("completed"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("backup_logs_created_idx").on(t.createdAt)]);
