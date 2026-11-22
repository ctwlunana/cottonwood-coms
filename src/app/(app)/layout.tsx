import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { roles } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { navFor, GROUP_LABEL } from "@/lib/nav";
import { unreadCount } from "@/lib/notify";
import { Shell } from "@/components/shell";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor({ allowPasswordChange: true });
  const [unread, roleRows] = await Promise.all([
    unreadCount(db, actor.id),
    actor.roleSlugs.length ? db.select({ name: roles.name }).from(roles).where(inArray(roles.slug, actor.roleSlugs)) : Promise.resolve([]),
  ]);
  return (
    <Shell items={navFor(actor).map(({ anyOf: _a, ...i }) => i)} groups={GROUP_LABEL} unread={unread}
      user={{ name: actor.fullName, roles: roleRows.map((r) => r.name).join(", ") || "Tanpa peran" }} logout={logoutAction}>
      {children}
    </Shell>
  );
}
