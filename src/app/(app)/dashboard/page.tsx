import Link from "next/link";
import { and, isNull, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetRequests } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { can, scopeOf } from "@/lib/authz";
import { listProperties, propertyStats, PROPERTY_STATUS_LABEL } from "@/services/properties";
import { listMyNotifications } from "@/services/notifications";
import { PageHeader, Stat, Card, Empty, Badge } from "@/components/ui";
import { PropertyStatusBadge } from "@/components/badges";
import { fmtRelative } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const actor = await requireActor();
  const showProps = can(actor, "property.view");
  const propScope = scopeOf(actor, "property.view");
  const [stats, myVillas, notif, activeEmployees, resetReqs] = await Promise.all([
    showProps ? propertyStats(db, actor) : null,
    showProps && propScope !== "all" && propScope !== "department" ? listProperties(db, actor) : null,
    listMyNotifications(db, actor, { unreadOnly: true }),
    scopeOf(actor, "employee.view") === "all"
      ? db.select({ c: sql<number>`count(*)::int` }).from(users).where(eq(users.isActive, true)).then((r) => r[0].c) : null,
    can(actor, "employee.reset_password")
      ? db.select({ c: sql<number>`count(*)::int` }).from(passwordResetRequests).where(isNull(passwordResetRequests.handledAt)).then((r) => r[0].c) : null,
  ]);
  const wide = propScope === "all" || propScope === "department";
  const total = stats ? Object.values(stats.byStatus).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader title={`Halo, ${actor.fullName}`} subtitle="Ringkasan dari data COMS saat ini." />

      {stats && (
        <div className={`mb-6 grid grid-cols-2 gap-3 ${wide ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-3"}`}>
          <Stat label={wide ? "Total villa" : "Villa saya"} value={total} href="/properti" />
          <Stat label={PROPERTY_STATUS_LABEL.active} value={stats.byStatus.active ?? 0} tone="green" href="/properti?status=active" />
          <Stat label={PROPERTY_STATUS_LABEL.under_maintenance} value={stats.byStatus.under_maintenance ?? 0} tone="yellow" href="/properti?status=under_maintenance" />
          {wide && <Stat label={PROPERTY_STATUS_LABEL.temporarily_unavailable} value={stats.byStatus.temporarily_unavailable ?? 0} tone="yellow" href="/properti?status=temporarily_unavailable" />}
          {wide && <Stat label={PROPERTY_STATUS_LABEL.inactive} value={stats.byStatus.inactive ?? 0} href="/properti?status=inactive" />}
          {wide && <Stat label="Tanpa Villa Keeper" value={stats.withoutKeeper} tone={stats.withoutKeeper ? "red" : "green"} href="/properti?keeper=none" hint="Villa tanpa penanggung jawab" />}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {myVillas && (
          <Card title="Villa yang ditugaskan kepada saya" className="lg:col-span-2">
            {myVillas.rows.length === 0 ? <Empty title="Belum ada villa yang ditugaskan" hint="Hubungi Supervisor Villa untuk penugasan." /> : (
              <ul className="divide-y divide-slate-100">
                {myVillas.rows.map((v) => (
                  <li key={v.id}>
                    <Link href={`/properti/${v.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                      <div className="min-w-0"><div className="truncate font-medium">{v.name}</div><div className="text-xs text-slate-500">{v.code} · {v.location}</div></div>
                      <PropertyStatusBadge status={v.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Notifikasi belum dibaca" actions={<Link href="/notifikasi" className="text-sm link">Semua</Link>}>
          {notif.rows.length === 0 ? <p className="text-sm text-slate-500">Tidak ada notifikasi baru.</p> : (
            <ul className="space-y-3">
              {notif.rows.slice(0, 6).map((n) => (
                <li key={n.id} className="text-sm">
                  <Link href={`/notifikasi/${n.id}`} className="font-medium hover:underline">{n.title}</Link>
                  {n.priority === "critical" && <> <Badge tone="red">Kritis</Badge></>}
                  <div className="text-xs text-slate-500">{fmtRelative(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(activeEmployees !== null || resetReqs !== null) && (
          <Card title="Administrasi akun">
            <div className="grid grid-cols-2 gap-3">
              {activeEmployees !== null && <Stat label="Karyawan aktif" value={activeEmployees} href="/karyawan" />}
              {resetReqs !== null && <Stat label="Permintaan reset password" value={resetReqs} tone={resetReqs ? "yellow" : "gray"} href="/karyawan?reset=1" />}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
