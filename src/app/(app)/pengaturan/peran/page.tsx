import Link from "next/link";
import { Fragment } from "react";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { getMatrix, listRoles } from "@/services/rbac";
import { PROTECTED_PERMISSIONS } from "@/lib/permissions";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { SCOPE_SHORT } from "@/components/badges";
import { createRoleAction } from "../actions";

export const metadata = { title: "Peran & Hak Akses" };
const DOT = { own: "S", assigned: "T", department: "D", all: "●" } as const;

export default async function RolesMatrix() {
  const actor = await requireActor();
  const res = await load(async () => Promise.all([getMatrix(db, actor), listRoles(db, actor)]));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [{ roles, permissions, grants }, roleStats] = res.data;
  const fin = new Set<string>(PROTECTED_PERMISSIONS);
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <>
      <PageHeader title="Peran & Hak Akses" back={{ href: "/pengaturan", label: "Pengaturan" }}
        subtitle={<>Klik nama peran untuk mengubah. Cakupan: <b>●</b> {SCOPE_SHORT.all} · <b>D</b> {SCOPE_SHORT.department} · <b>T</b> villa {SCOPE_SHORT.assigned.toLowerCase()} · <b>S</b> milik {SCOPE_SHORT.own.toLowerCase()}. Baris kuning = hak akses dilindungi: keuangan, approval, backup (hanya GM yang dapat mengubah).</>} />
      <div className="card mb-6 overflow-auto" style={{ maxHeight: "70vh" }}>
        <table className="text-xs">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th className="sticky left-0 z-20 min-w-64 border-b border-slate-200 bg-white px-2 py-2 text-left">Hak akses</th>
              {roles.map((r) => (
                <th key={r.id} className="border-b border-slate-200 px-1 py-2 align-bottom">
                  <Link href={`/pengaturan/peran/${r.id}`} className="link block w-6 whitespace-nowrap [writing-mode:vertical-rl] rotate-180 text-left">{r.name}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <Fragment key={m}>
                <tr><td colSpan={roles.length + 1} className="sticky left-0 bg-slate-100 px-2 py-1 font-semibold text-slate-600">{m}</td></tr>
                {permissions.filter((p) => p.module === m).map((p) => (
                  <tr key={p.code} className={fin.has(p.code) ? "bg-amber-50" : "hover:bg-slate-50"}>
                    <td className={`sticky left-0 border-b border-slate-100 px-2 py-1 ${fin.has(p.code) ? "bg-amber-50" : "bg-white"}`} title={p.code}>
                      {p.description}<span className="ml-1 font-mono text-[10px] text-slate-400">{p.code}</span>
                    </td>
                    {roles.map((r) => {
                      const s = grants.get(`${r.id}|${p.code}`);
                      return <td key={r.id} className="border-b border-slate-100 text-center font-semibold text-brand-700" title={s ? `${r.name}: ${s}` : undefined}>{s ? (p.scoped ? DOT[s] : "●") : ""}</td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Jumlah anggota per peran">
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {roleStats.map((r) => <li key={r.id} className="flex justify-between"><Link className="link" href={`/karyawan?role=${r.id}`}>{r.name}</Link><span className="tabular-nums text-slate-500">{r.members}</span></li>)}
          </ul>
        </Card>
        <Card title="Buat peran baru">
          <ActionForm action={createRoleAction}>
            <Field label="Slug *" name="slug" hint="huruf kecil & garis bawah, mis. vendor_ac"><input id="slug" name="slug" className="input" required /></Field>
            <Field label="Nama peran *" name="name"><input id="name" name="name" className="input" required /></Field>
            <Field label="Deskripsi" name="description"><input id="description" name="description" className="input" /></Field>
            <SubmitButton>Buat peran</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
