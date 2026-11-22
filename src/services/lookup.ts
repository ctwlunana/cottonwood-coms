import { and, eq, inArray, asc } from "drizzle-orm";
import type { Tx } from "@/db";
import { users, userRoles, roles } from "@/db/schema";

/** Active users holding any of the given roles (for pickers / filters; names only). */
export async function usersWithRoles(tx: Tx, slugs: string[]) {
  return tx.selectDistinct({ id: users.id, fullName: users.fullName, employeeCode: users.employeeCode })
    .from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.isActive, true), inArray(roles.slug, slugs))).orderBy(asc(users.fullName));
}
