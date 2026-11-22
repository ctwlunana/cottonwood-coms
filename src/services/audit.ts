import { and, eq, gte, lte, desc, ilike, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { type Actor, requirePermission } from "@/lib/authz";

export type AuditFilters = { userId?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; page?: number };
export const AUDIT_PAGE = 50;

export async function listAudit(tx: Tx, actor: Actor, f: AuditFilters = {}) {
  const scope = requirePermission(actor, "audit.view");
  const conds: (SQL | undefined)[] = [];
  if (scope !== "all") conds.push(eq(auditLogs.userId, actor.id)); // non-company scope: own actions only
  if (f.userId) conds.push(eq(auditLogs.userId, f.userId));
  if (f.entityType) conds.push(eq(auditLogs.entityType, f.entityType));
  if (f.entityId) conds.push(eq(auditLogs.entityId, f.entityId));
  if (f.action) conds.push(ilike(auditLogs.action, `%${f.action}%`));
  if (f.from) conds.push(gte(auditLogs.at, new Date(`${f.from}T00:00:00+07:00`)));
  if (f.to) conds.push(lte(auditLogs.at, new Date(`${f.to}T23:59:59.999+07:00`)));
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    tx.select({ log: auditLogs, user: users.fullName }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where).orderBy(desc(auditLogs.id)).limit(AUDIT_PAGE).offset((page - 1) * AUDIT_PAGE),
    tx.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
  ]);
  return { rows, total, page, pageSize: AUDIT_PAGE };
}
