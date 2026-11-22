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
import { fmtRelative, fmtDateTime } from "@/lib/format";
import { lastSuccessfulBackup } from "@/services/backup";
import { todayChecklistStatus } from "@/services/checklists";
import { listWorkOrders, maintenanceStats } from "@/services/maintenance";
import { listAssignments, dailySummary } from "@/services/housekeeping";
import { todayJakarta } from "@/services/villa-relations";
import { WoStatusBadge, HkStatusBadge, PriorityBadge } from "@/components/badges";
import { HK_STATUS_LABEL } from "@/lib/labels";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const actor = await requireActor();
  const showProps = can(actor, "property.view");
  const propScope = scopeOf(actor, "property.view");
  const [stats, myVillas, notif, activeEmployees, resetReqs, lastBackup] = await Promise.all([
    showProps ? propertyStats(db, actor) : null,
    showProps && propScope !== "all" && propScope !== "department" ? listProperties(db, actor) : null,
    listMyNotifications(db, actor, { unreadOnly: true }),
    scopeOf(actor, "employee.view") === "all"
      ? db.select({ c: sql<number>`count(*)::int` }).from(users).where(eq(users.isActive, true)).then((r) => r[0].c) : null,
    can(actor, "employee.reset_password")
      ? db.select({ c: sql<number>`count(*)::int` }).from(passwordResetRequests).where(isNull(passwordResetRequests.handledAt)).then((r) => r[0].c) : null,
    can(actor, "backup.run") ? lastSuccessfulBackup(db).then((d) => d ?? "never") : null,
  ]);
  const backupStale = lastBackup === "never" || (lastBackup instanceof Date && Date.now() - lastBackup.getTime() > 7 * 86400_000);
  const wide = propScope === "all" || propScope === "department";
  const woScope = scopeOf(actor, "maintenance.view");
  const [checklistToday, myWos, villaWos, woStats, myCleaning, toInspect, hkToday] = await Promise.all([
    can(actor, "checklist.submit") ? todayChecklistStatus(db, actor) : null,
    can(actor, "maintenance.work") ? listWorkOrders(db, actor, { mine: true }) : null,
    woScope === "assigned" ? listWorkOrders(db, actor, {}) : null,
    woScope === "all" ? maintenanceStats(db, actor) : null,
    can(actor, "housekeeping.work") ? listAssignments(db, actor, { mine: true, open: true }) : null,
    can(actor, "housekeeping.view") && scopeOf(actor, "housekeeping.view") !== "own" ? listAssignments(db, actor, { status: "inspection_required" }) : null,
    can(actor, "housekeeping.schedule") ? dailySummary(db, actor, todayJakarta()) : null,
  ]);
  const total = stats ? Object.values(stats.byStatus).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader title={`Halo, ${actor.fullName}`} subtitle="Ringkasan dari data COMS saat ini." />
      {lastBackup !== null && backupStale && (
        <Link href="/pengaturan/backup" className="mb-4 block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {lastBackup === "never" ? "Belum pernah ada backup data." : `Backup terakhir ${fmtDateTime(lastBackup as Date)} (lebih dari 7 hari).`} Klik untuk membuat <b>Backup File</b> sekarang.
        </Link>
      )}

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

      {(can(actor, "checklist.submit") || can(actor, "maintenance.report")) && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:flex">
          {can(actor, "checklist.submit") && <Link href="/checklist/baru" className="btn-primary py-3">✓ Isi checklist</Link>}
          {can(actor, "maintenance.report") && <Link href="/maintenance/lapor" className="btn-secondary py-3">⚒ Lapor kerusakan</Link>}
        </div>
      )}

      {woStats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="WO terbuka" value={woStats.open} href="/maintenance" />
          <Stat label="WO kritis" value={woStats.critical} tone={woStats.critical ? "red" : "gray"} href="/maintenance?priority=critical" />
          <Stat label="WO terlambat" value={woStats.overdue} tone={woStats.overdue ? "red" : "gray"} href="/maintenance?overdue=1" />
          {can(actor, "maintenance.review") && <Stat label="Laporan perlu ditinjau" value={woStats.pendingRequests} tone={woStats.pendingRequests ? "yellow" : "gray"} href="/maintenance?tab=permintaan" />}
          <Stat label="Perlu verifikasi" value={woStats.toVerify} tone={woStats.toVerify ? "blue" : "gray"} href="/maintenance?status=completed" />
        </div>
      )}
      {hkToday && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Pembersihan hari ini" value={hkToday.list.filter((r) => r.a.status !== "cancelled").length} href="/housekeeping" />
          <Stat label="Belum ada petugas" value={hkToday.byStatus.pending ?? 0} tone={hkToday.byStatus.pending ? "yellow" : "gray"} href="/housekeeping?status=pending" />
          <Stat label={HK_STATUS_LABEL.inspection_required} value={hkToday.byStatus.inspection_required ?? 0} tone="blue" href="/housekeeping?status=inspection_required" />
          <Stat label="Perlu ulang" value={(hkToday.byStatus.inspection_failed ?? 0) + (hkToday.byStatus.reclean_required ?? 0)} tone="red" href="/housekeeping?status=inspection_failed" />
          <Stat label="Siap" value={hkToday.byStatus.ready ?? 0} tone="green" href="/housekeeping?status=ready" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {myCleaning && (
          <Card title="Tugas pembersihan saya" className="lg:col-span-2">
            {myCleaning.length === 0 ? <p className="text-sm text-slate-500">Tidak ada tugas aktif.</p> : (
              <ul className="divide-y divide-slate-100">{myCleaning.map(({ a, villa }) => (
                <li key={a.id}><Link href={`/housekeeping/${a.id}`} className="flex items-center justify-between gap-2 py-3"><span className="font-medium">{villa}<span className="block text-xs font-normal text-slate-500">target {fmtDateTime(a.expectedDoneAt)}</span></span><HkStatusBadge s={a.status} /></Link></li>
              ))}</ul>
            )}
          </Card>
        )}
        {myWos && (
          <Card title="Work order saya" className="lg:col-span-2" actions={<Link href="/maintenance?mine=1" className="link text-sm">Semua</Link>}>
            {myWos.rows.length === 0 ? <p className="text-sm text-slate-500">Tidak ada work order aktif.</p> : (
              <ul className="divide-y divide-slate-100">{myWos.rows.slice(0, 8).map(({ wo, villa }) => (
                <li key={wo.id}><Link href={`/maintenance/${wo.id}`} className="flex items-center justify-between gap-2 py-3"><span className="min-w-0"><span className="block truncate font-medium">{wo.title}</span><span className="text-xs text-slate-500">{villa} · batas {fmtDateTime(wo.deadline)}</span></span><span className="flex gap-1"><PriorityBadge p={wo.priority} /><WoStatusBadge s={wo.status} /></span></Link></li>
              ))}</ul>
            )}
          </Card>
        )}
        {checklistToday && checklistToday.length > 0 && (
          <Card title="Checklist hari ini">
            <ul className="divide-y divide-slate-100">{checklistToday.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2.5"><span className="truncate text-sm font-medium">{v.name}</span>
                {v.doneAt ? <Badge tone={v.fails ? "red" : "green"}>{v.fails ? `${v.fails} masalah` : "Selesai"}</Badge> : <Link className="btn-primary px-3 py-1 text-xs" href={`/checklist/baru?villa=${v.id}`}>Isi</Link>}</li>
            ))}</ul>
          </Card>
        )}
        {villaWos && (
          <Card title="Maintenance di villa saya" actions={<Link href="/maintenance" className="link text-sm">Semua</Link>}>
            {villaWos.rows.length === 0 ? <p className="text-sm text-slate-500">Tidak ada work order terbuka.</p> : (
              <ul className="space-y-2">{villaWos.rows.slice(0, 6).map(({ wo, villa }) => (
                <li key={wo.id}><Link href={`/maintenance/${wo.id}`} className="block text-sm"><span className="font-medium">{wo.title}</span> <WoStatusBadge s={wo.status} />
                  <span className="block text-xs text-slate-500">{villa}{wo.status === "verified" && " · menunggu konfirmasi Anda"}</span></Link></li>
              ))}</ul>
            )}
          </Card>
        )}
        {toInspect && toInspect.length > 0 && (
          <Card title="Menunggu inspeksi kesiapan">
            <ul className="space-y-2">{toInspect.map(({ a, villa }) => (
              <li key={a.id}><Link href={`/housekeeping/${a.id}`} className="block text-sm"><span className="font-medium">{villa}</span><span className="block text-xs text-slate-500">selesai dibersihkan {fmtDateTime(a.cleaningCompletedAt)}</span></Link></li>
            ))}</ul>
          </Card>
        )}
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
