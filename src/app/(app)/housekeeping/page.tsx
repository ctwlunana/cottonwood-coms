import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can, scopeOf } from "@/lib/authz";
import { load } from "@/lib/page";
import { dailySummary, listAssignments, housekeepingMetrics } from "@/services/housekeeping";
import { todayJakarta } from "@/services/villa-relations";
import { PageHeader, Empty, Stat, Card, Badge } from "@/components/ui";
import { HkStatusBadge, PriorityBadge } from "@/components/badges";
import { Forbidden } from "@/components/forbidden";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { HK_STATUS_LABEL, type HkStatus } from "@/lib/labels";

export const metadata = { title: "Housekeeping" };

export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<{ date?: string; status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayJakarta();
  const own = scopeOf(actor, "housekeeping.view") === "own";
  const res = await load(async () => {
    const summary = await dailySummary(db, actor, date);
    const mine = can(actor, "housekeeping.work") ? await listAssignments(db, actor, { mine: true, open: true }) : [];
    const from = new Date(`${date}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 6);
    const metrics = !own ? await housekeepingMetrics(db, actor, from.toISOString().slice(0, 10), date) : null;
    return { summary, mine, metrics };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { summary, mine, metrics } = res.data;
  const shown = sp.status ? summary.list.filter((r) => r.a.status === sp.status) : summary.list;
  const prev = new Date(`${date}T00:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <>
      <PageHeader title="Housekeeping" subtitle={`Jadwal ${fmtDate(date)}`} actions={<>
        {can(actor, "housekeeping.team_manage") && <Link href="/housekeeping/tim" className="btn-secondary">Tim</Link>}
        {can(actor, "housekeeping.schedule") && <Link href={`/housekeeping/baru?date=${date}`} className="btn-primary">+ Jadwalkan</Link>}
      </>} />

      {mine.length > 0 && (
        <Card title="Tugas saya" className="mb-4 border-brand-600">
          <ul className="divide-y divide-slate-100">
            {mine.map(({ a, villa, location }) => (
              <li key={a.id}><Link href={`/housekeeping/${a.id}`} className="flex items-center justify-between gap-2 py-3">
                <span className="min-w-0"><span className="block truncate font-medium">{villa}</span><span className="text-xs text-slate-500">{location} · target {fmtDateTime(a.expectedDoneAt)}</span></span>
                <HkStatusBadge s={a.status} /></Link></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Link className="btn-secondary px-3" href={`?date=${prev.toISOString().slice(0, 10)}`} aria-label="Hari sebelumnya">←</Link>
        <form method="get" className="flex gap-2"><input type="date" name="date" defaultValue={date} className="input w-auto" aria-label="Tanggal" /><button className="btn-secondary" type="submit">Lihat</button></form>
        <Link className="btn-secondary px-3" href={`?date=${next.toISOString().slice(0, 10)}`} aria-label="Hari berikutnya">→</Link>
        {date !== todayJakarta() && <Link className="link text-sm" href="?">Hari ini</Link>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {(["pending", "assigned", "in_progress", "inspection_required", "inspection_failed", "reclean_required", "ready", "cancelled"] as HkStatus[]).map((s) => (
          <Link key={s} href={`?date=${date}${sp.status === s ? "" : `&status=${s}`}`} className={`card p-2 text-center ${sp.status === s ? "border-brand-600 bg-brand-50" : ""}`}>
            <div className="text-xl font-semibold tabular-nums">{summary.byStatus[s] ?? 0}</div><div className="text-[11px] text-slate-500">{HK_STATUS_LABEL[s]}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {shown.length === 0 ? <Empty title="Tidak ada penugasan" hint={can(actor, "housekeeping.schedule") ? "Jadwalkan pembersihan untuk villa yang checkout." : undefined} /> : (
            <ul className="space-y-2">
              {shown.map(({ a, villa, location, staff, team }) => {
                const late = !["ready", "cancelled"].includes(a.status) && a.expectedDoneAt < new Date();
                return (
                  <li key={a.id}><Link href={`/housekeeping/${a.id}`} className="card block p-3 hover:border-brand-600">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{villa}</span><HkStatusBadge s={a.status} /><PriorityBadge p={a.priority} />{late && <Badge tone="red">Lewat target</Badge>}{a.recleanCount > 0 && <Badge tone="yellow">Ulang ×{a.recleanCount}</Badge>}</div>
                    <div className="mt-1 text-xs text-slate-500">{location}{team && ` · ${team}`} · target {fmtDateTime(a.expectedDoneAt)}</div>
                    <div className="mt-0.5 text-xs">{staff.length ? staff.join(", ") : <span className="text-red-600">Belum ada petugas</span>}</div>
                  </Link></li>
                );
              })}
            </ul>
          )}
        </div>
        {!own && (
          <div className="space-y-4">
            {metrics && (
              <Card title="7 hari terakhir">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Tugas" value={metrics.total} />
                  <Stat label="Siap" value={metrics.ready} tone="green" />
                  <Stat label="Tepat waktu" value={pct(metrics.onTime, metrics.ready)} hint="dari villa siap" />
                  <Stat label="Re-clean" value={pct(metrics.recleaned, metrics.total)} tone={metrics.recleaned ? "yellow" : "gray"} hint={`${metrics.failedInspections} inspeksi gagal`} />
                </div>
                {metrics.perStaff.length > 0 && (
                  <table className="mt-3 w-full text-xs"><thead><tr className="text-left text-slate-500"><th>Housekeeper</th><th>Selesai</th><th>Ulang</th></tr></thead>
                    <tbody>{metrics.perStaff.map((p) => <tr key={p.fullName}><td>{p.fullName}</td><td className="tabular-nums">{p.done}</td><td className="tabular-nums">{p.recleaned}</td></tr>)}</tbody></table>
                )}
              </Card>
            )}
            <Card title={`Tenaga kerja ${fmtDate(date)}`}>
              {summary.manpower.length === 0 ? <p className="text-sm text-slate-500">Belum ada housekeeper.</p> : (
                <ul className="space-y-1 text-sm">
                  {summary.manpower.map((m) => <li key={m.id} className="flex justify-between"><span>{m.fullName}</span><span className={`tabular-nums ${m.tasks === 0 ? "text-slate-400" : m.tasks > 3 ? "font-semibold text-amber-700" : ""}`}>{m.tasks} tugas</span></li>)}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
