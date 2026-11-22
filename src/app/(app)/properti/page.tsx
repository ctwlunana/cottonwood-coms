import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can, scopeOf } from "@/lib/authz";
import { load } from "@/lib/page";
import { listProperties, listLocations, PROPERTY_STATUSES, PROPERTY_STATUS_LABEL } from "@/services/properties";
import { usersWithRoles } from "@/services/lookup";
import { PageHeader, Empty, Pagination, DemoBadge } from "@/components/ui";
import { PropertyStatusBadge } from "@/components/badges";
import { AutoSubmitSelect } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";

export const metadata = { title: "Properti / Villa" };
type SP = { q?: string; location?: string; keeper?: string; status?: string; page?: string };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(async () => {
    const [list, locs] = await Promise.all([
      listProperties(db, actor, { q: sp.q, locationId: sp.location, keeperId: sp.keeper, status: sp.status, page: Number(sp.page) || 1 }),
      listLocations(db, actor),
    ]);
    const wide = scopeOf(actor, "property.view") === "all" || scopeOf(actor, "property.view") === "department";
    const keepers = wide ? await usersWithRoles(db, ["villa_keeper", "location_pic", "supervisor_villa"]) : [];
    return { list, locs, keepers, wide };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { list, locs, keepers, wide } = res.data;

  return (
    <>
      <PageHeader title="Properti / Villa" subtitle={wide ? "Seluruh villa perusahaan" : "Villa yang ditugaskan kepada Anda"}
        actions={can(actor, "property.manage") && <Link href="/properti/baru" className="btn-primary">+ Tambah villa</Link>} />

      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="q" defaultValue={sp.q} placeholder="Cari nama / kode villa…" className="input lg:col-span-2" />
        <AutoSubmitSelect name="location" defaultValue={sp.location ?? ""} className="input">
          <option value="">Semua lokasi</option>
          {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="status" defaultValue={sp.status ?? ""} className="input">
          <option value="">Semua status</option>
          {PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{PROPERTY_STATUS_LABEL[s]}</option>)}
        </AutoSubmitSelect>
        {wide ? (
          <AutoSubmitSelect name="keeper" defaultValue={sp.keeper ?? ""} className="input">
            <option value="">Semua Villa Keeper</option>
            <option value="none">— Tanpa Villa Keeper —</option>
            {keepers.map((k) => <option key={k.id} value={k.id}>{k.fullName}</option>)}
          </AutoSubmitSelect>
        ) : <button className="btn-secondary" type="submit">Terapkan</button>}
      </form>

      {list.rows.length === 0 ? <Empty title="Tidak ada villa" hint={sp.q || sp.status || sp.location || sp.keeper ? "Coba ubah filter." : "Belum ada data villa."} /> : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {list.rows.map((v) => (
              <li key={v.id}>
                <Link href={`/properti/${v.id}`} className="card block p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="truncate font-medium">{v.name} <DemoBadge show={v.isDemo} /></div>
                      <div className="text-xs text-slate-500">{v.code} · {v.location}</div></div>
                    <PropertyStatusBadge status={v.status} />
                  </div>
                  <div className="mt-2 text-xs text-slate-600">Keeper: {v.keeper ?? <span className="font-medium text-red-600">Belum ada</span>} · {v.bedrooms} KT / {v.bathrooms} KM</div>
                </Link>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead><tr><th>Kode</th><th>Villa</th><th>Lokasi</th><th>Villa Keeper</th><th>KT/KM</th><th>Status</th></tr></thead>
              <tbody>
                {list.rows.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="font-mono text-xs">{v.code}</td>
                    <td><Link href={`/properti/${v.id}`} className="link font-medium">{v.name}</Link> <DemoBadge show={v.isDemo} /></td>
                    <td>{v.location}</td>
                    <td>{v.keeper ?? <span className="text-red-600">Belum ada</span>}</td>
                    <td className="tabular-nums">{v.bedrooms} / {v.bathrooms}</td>
                    <td><PropertyStatusBadge status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Pagination page={list.page} total={list.total} pageSize={list.pageSize} params={{ q: sp.q, location: sp.location, keeper: sp.keeper, status: sp.status }} />
    </>
  );
}
