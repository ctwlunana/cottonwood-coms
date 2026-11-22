import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { listEmployees, listDepartments } from "@/services/employees";
import { listRoles } from "@/services/rbac";
import { PageHeader, Empty, Pagination, Badge, DemoBadge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Karyawan" };
type SP = { q?: string; dept?: string; role?: string; status?: string; reset?: string; page?: string };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(async () => Promise.all([
    listEmployees(db, actor, { q: sp.q, departmentId: sp.dept, roleId: sp.role, status: (sp.status as "all") ?? "active", pendingReset: sp.reset === "1", page: Number(sp.page) || 1 }),
    listDepartments(db), listRoles(db, actor),
  ]));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [list, depts, roles] = res.data;
  return (
    <>
      <PageHeader title="Karyawan" subtitle={sp.reset === "1" ? "Menampilkan karyawan dengan permintaan reset password" : undefined}
        actions={can(actor, "employee.manage") && <Link href="/karyawan/baru" className="btn-primary">+ Tambah karyawan</Link>} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="q" defaultValue={sp.q} placeholder="Cari nama, username, kode…" className="input lg:col-span-2" />
        <AutoSubmitSelect name="dept" defaultValue={sp.dept ?? ""} className="input"><option value="">Semua departemen</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</AutoSubmitSelect>
        <AutoSubmitSelect name="role" defaultValue={sp.role ?? ""} className="input"><option value="">Semua peran</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</AutoSubmitSelect>
        <AutoSubmitSelect name="status" defaultValue={sp.status ?? "active"} className="input"><option value="active">Aktif</option><option value="inactive">Nonaktif</option><option value="all">Semua</option></AutoSubmitSelect>
      </form>
      {list.rows.length === 0 ? <Empty title="Tidak ada karyawan" /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Nama</th><th className="hidden sm:table-cell">Kode</th><th>Departemen</th><th className="hidden md:table-cell">Peran</th><th className="hidden lg:table-cell">Login terakhir</th><th>Status</th></tr></thead>
            <tbody>
              {list.rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td><Link className="link font-medium" href={`/karyawan/${u.id}`}>{u.fullName}</Link> <DemoBadge show={u.isDemo} /><div className="text-xs text-slate-500">{u.username}</div></td>
                  <td className="hidden font-mono text-xs sm:table-cell">{u.employeeCode}</td>
                  <td>{u.department ?? "—"}</td>
                  <td className="hidden md:table-cell">{u.roles.join(", ") || <span className="text-red-600">Tanpa peran</span>}</td>
                  <td className="hidden text-xs lg:table-cell">{fmtDateTime(u.lastLoginAt)}</td>
                  <td>{u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={list.page} total={list.total} pageSize={list.pageSize} params={{ q: sp.q, dept: sp.dept, role: sp.role, status: sp.status, reset: sp.reset }} />
    </>
  );
}
