import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { users } from "@/db/schema";
import { loadActor, type Actor } from "@/lib/authz";

class Rollback extends Error {}

/** Run a test body inside a transaction that is always rolled back (isolated tests). */
export async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T;
  try {
    await db.transaction(async (tx) => { out = await fn(tx); throw new Rollback(); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out!;
}

export async function actorFor(tx: Tx, username: string): Promise<Actor> {
  const [u] = await tx.select().from(users).where(eq(users.username, username));
  if (!u) throw new Error(`no user ${username}`);
  return loadActor(tx, u.id, { ip: "127.0.0.1", userAgent: "vitest" });
}
export async function userId(tx: Tx, username: string) {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username));
  return u.id;
}
