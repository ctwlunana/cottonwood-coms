import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can, scopeOf } from "@/lib/authz";
import { load } from "@/lib/page";
import { listWorkOrders, listRequests, maintenanceStats, engineersForPicker } from "@/services/maintenance";
import { PageHeader, Empty, Pagination, Stat, Badge } from "@/components/ui";
import { PriorityBadge, WoStatusBadge } from "@/components/badges";
import { AutoSubmitSelect } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { CATEGORY_LABEL, MR_STATUS_LABEL, PRIORITIES, PRIORITY_LABEL, WO_STATUS_LABEL } from "@/lib/labels";

export const metadata = { title: "Maintenance" };
type SP = { tab?: string; status?: string; priority?: string; assignee?: string; overdue?: string; repeat?: string; q?: string; page?: string; mine?: string };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const canView = can(actor, "maintenance.view");
  const isReviewer = can(actor, "maintenance.review");
  const tab = sp.tab ?? (canView ? "wo" : "saya");
  const res = await load(async () => {
    const stats = canView && scopeOf(actor, "maintenance.view") !== "own" ? await maintenanceStats(db, actor) : null;
    const wos = tab === "wo" && canView ? await listWorkOrders(db, actor, {
      status: (sp.status as "open") ?? "open", priority: sp.priority, assignee: sp.assignee, overdue: sp.overdue === "1", repeat: sp.repeat === "1", q: sp.q, mine: sp.mine === "1", page: Number(sp.page) || 1,
    }) : null;
    const requests = tab === "permintaan" ? await listRequests(db, actor, { status: "pending_review" }) : tab === "saya" ? await listRequests(db, actor, { mine: true }) : null;
    const engineers = can(actor, "maintenance.assign") ? await engineersForPicker(db, actor) : [];
    return { stats, wos, requests, engineers };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { stats, wos, requests, engineers } = res.data;
  const tabs = [
    canView && ["wo", "Work order"],
    isReviewer && ["permintaan", `Perlu ditinjau${stats?.pendingRequests ? ` (${stats.pendingRequests})` : ""}`],
    can(actor, "maintenance.report") && ["saya", "Laporan saya"],
    can(actor, "maintenance.pm_manage") && ["preventif", "Preventif & peralatan"],
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <PageHeader title="Maintenance" actions={can(actor, "maintenance.report") && <Link href="/maintenance/lapor" className="btn-primary">+ Lapor kerusakan</Link>} />
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="WO terbuka" value={stats.open} href="/maintenance?status=open" />
          <Stat label="Kritis" value={stats.critical} tone={stats.critical ? "red" : "gray"} href="/maintenance?priority=critical" />
          {isReviewer && <Stat label="Perlu ditinjau" value={stats.pendingRequests} tone={stats.pendingRequests ? "yellow" : "gray"} href="/maintenance?tab=permintaan" />}
          <Stat label="Belum ditugaskan" value={stats.unassigned} tone={stats.unassigned ? "yellow" : "gray"} href="/maintenance?status=new" />
          <Stat label="Terlambat" value={stats.overdue} tone={stats.overdue ? "red" : "gray"} href="/maintenance?overdue=1" />
          <Stat label="Perlu verifikasi" value={stats.toVerify} tone={stats.toVerify ? "blue" : "gray"} href="/maintenance?status=completed" />
          <Stat label="Masalah berulang" value={stats.repeat} tone={stats.repeat ? "purple" : "gray"} href="/maintenance?repeat=1" />
        </div>
      )}
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, l]) => (
          <Link key={k} href={k === "preventif" ? "/maintenance/preventif" : `/maintenance?tab=${k}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-700 font-semibold text-brand-800" : "border-transparent text-slate-600"}`}>{l}</Link>
        ))}
      </nav>

      {wos && (
        <>
          <form className="card mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" method="get">
            <input type="hidden" name="tab" value="wo" />
            <input name="q" defaultValue={sp.q} placeholder="Cari kode / judul…" className="input lg:col-span-2" />
            <AutoSubmitSelect name="status" defaultValue={sp.status ?? "open"} className="input">
              <option value="open">Semua terbuka</option><option value="closed">Ditutup / batal</option><option value="all">Semua</option>
              {Object.entries(WO_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </AutoSubmitSelect>
            <AutoSubmitSelect name="priority" defaultValue={sp.priority ?? ""} className="input">
              <option value="">Semua prioritas</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </AutoSubmitSelect>
            {engineers.length > 0 ? (
              <AutoSubmitSelect name="assignee" defaultValue={sp.assignee ?? ""} className="input">
                <option value="">Semua engineer</option><option value="none">— Belum ditugaskan —</option>
                {engineers.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.open})</option>)}
              </AutoSubmitSelect>
            ) : <span />}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} /> Terlambat</label>
          </form>
          {wos.rows.length === 0 ? <Empty title="Tidak ada work order" /> : (
            <ul className="space-y-2">
              {wos.rows.map(({ wo, villa, assignee }) => {
                const late = wo.deadline && wo.deadline < new Date() && !["completed", "verified", "closed", "cancelled"].includes(wo.status);
                return (
                  <li key={wo.id}>
                    <Link href={`/maintenance/${wo.id}`} className={`card block p-3 hover:border-brand-600 ${wo.priority === "critical" && wo.status !== "closed" ? "border-l-4 border-l-red-500" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500">{wo.code}</span><WoStatusBadge s={wo.status} /><PriorityBadge p={wo.priority} />
                        {late && <Badge tone="red">Terlambat</Badge>}{wo.repeatIssue && <Badge tone="purple">Berulang</Badge>}</div>
                      <div className="mt-1 font-medium">{wo.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{villa} · {CATEGORY_LABEL[wo.category]} · {assignee ?? wo.vendorName ?? <span className="text-red-600">belum ditugaskan</span>} · batas {fmtDateTime(wo.deadline)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination page={wos.page} total={wos.total} pageSize={wos.pageSize} params={{ tab: "wo", status: sp.status, priority: sp.priority, assignee: sp.assignee, overdue: sp.overdue, q: sp.q }} />
        </>
      )}

      {requests && (requests.length === 0 ? <Empty title={tab === "permintaan" ? "Tidak ada laporan yang menunggu tinjauan" : "Anda belum membuat laporan"} /> : (
        <ul className="space-y-2">
          {requests.map(({ r, villa, by }) => (
            <li key={r.id}>
              <Link href={`/maintenance/permintaan/${r.id}`} className={`card block p-3 hover:border-brand-600 ${r.priority === "critical" ? "border-l-4 border-l-red-500" : ""}`}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500">{r.code}</span><Badge tone={r.status === "pending_review" ? "blue" : "gray"}>{MR_STATUS_LABEL[r.status]}</Badge><PriorityBadge p={r.priority} />
                  {r.repeatCount >= 2 && <Badge tone="purple">Berulang ({r.repeatCount})</Badge>}</div>
                <div className="mt-1 text-sm">{r.description.slice(0, 160)}</div>
                <div className="mt-0.5 text-xs text-slate-500">{villa} · {CATEGORY_LABEL[r.category]} · {by} · {fmtRelative(r.createdAt)}</div>
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}
