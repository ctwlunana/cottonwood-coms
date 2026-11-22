import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { listAudit } from "@/services/audit";
import { PageHeader, Empty, Pagination } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { ACTION_LABEL, ChangeTable } from "@/components/audit-list";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Audit Trail" };
type SP = { action?: string; entityType?: string; entityId?: string; from?: string; to?: string; page?: string };
const ENTITY_LINK: Record<string, string> = { property: "/properti/", user: "/karyawan/", location: "/lokasi/" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(() => listAudit(db, actor, { action: sp.action, entityType: sp.entityType, entityId: sp.entityId, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const list = res.data;
  return (
    <>
      <PageHeader title="Audit Trail" subtitle="Catatan permanen (append-only) semua tindakan penting. Tidak dapat diubah atau dihapus." />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="action" defaultValue={sp.action} placeholder="Tindakan (mis. property, auth.login)" className="input" />
        <select name="entityType" defaultValue={sp.entityType ?? ""} className="input">
          <option value="">Semua jenis data</option>
          {["user", "property", "location", "role", "department", "system_setting", "session", "import"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="Dari tanggal" />
        <input type="date" name="to" defaultValue={sp.to} className="input" aria-label="Sampai tanggal" />
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      {list.rows.length === 0 ? <Empty title="Tidak ada catatan" /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Waktu</th><th>Pengguna</th><th>Tindakan</th><th>Data</th><th className="w-1/3">Perubahan</th><th className="hidden xl:table-cell">IP</th></tr></thead>
            <tbody>
              {list.rows.map(({ log, user }) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(log.at)}</td>
                  <td className="text-sm">{user ?? "Sistem"}</td>
                  <td className="text-sm">{ACTION_LABEL[log.action] ?? log.action}<div className="font-mono text-[11px] text-slate-400">{log.action}</div></td>
                  <td className="text-xs">{log.entityType}{log.entityId && (ENTITY_LINK[log.entityType]
                    ? <> · <Link className="link" href={`${ENTITY_LINK[log.entityType]}${log.entityId}`}>buka</Link></> : <span className="block font-mono text-[11px] text-slate-400">{log.entityId.slice(0, 18)}</span>)}</td>
                  <td><ChangeTable before={log.before} after={log.after} /></td>
                  <td className="hidden font-mono text-xs xl:table-cell">{log.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={list.page} total={list.total} pageSize={list.pageSize} params={{ action: sp.action, entityType: sp.entityType, entityId: sp.entityId, from: sp.from, to: sp.to }} />
    </>
  );
}
