import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { propertyAssignments, locationAssignments, properties } from "@/db/schema";

/** How a user is attached to a villa (used for assignment-based rules such as readiness inspection). */
export async function villaRelation(tx: Tx, userId: string, propertyId: string) {
  const [p] = await tx.select({ locationId: properties.locationId }).from(properties).where(eq(properties.id, propertyId));
  if (!p) return { isKeeper: false, isInspector: false, isHkLeader: false, isLocationPic: false };
  const pa = await tx.select({ kind: propertyAssignments.kind }).from(propertyAssignments)
    .where(and(eq(propertyAssignments.propertyId, propertyId), eq(propertyAssignments.userId, userId), isNull(propertyAssignments.endedAt)));
  const la = await tx.select({ kind: locationAssignments.kind }).from(locationAssignments)
    .where(and(eq(locationAssignments.locationId, p.locationId), eq(locationAssignments.userId, userId), isNull(locationAssignments.endedAt)));
  return {
    isKeeper: pa.some((a) => a.kind === "villa_keeper"),
    isInspector: pa.some((a) => a.kind === "inspector"),
    isHkLeader: la.some((a) => a.kind === "hk_team_leader"),
    isLocationPic: la.some((a) => a.kind === "location_pic"),
  };
}

/** Active Villa Keeper of a villa (or null). */
export async function villaKeeperId(tx: Tx, propertyId: string): Promise<string | null> {
  const [k] = await tx.select({ id: propertyAssignments.userId }).from(propertyAssignments)
    .where(and(eq(propertyAssignments.propertyId, propertyId), eq(propertyAssignments.kind, "villa_keeper"), isNull(propertyAssignments.endedAt)));
  return k?.id ?? null;
}

/** Today's operational date in Asia/Jakarta as YYYY-MM-DD. */
export function todayJakarta(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
}
