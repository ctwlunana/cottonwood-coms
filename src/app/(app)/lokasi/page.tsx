import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { listLocations } from "@/services/properties";
import { PageHeader, Card, Empty, Badge, DemoBadge, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { createLocationAction } from "./actions";

export const metadata = { title: "Lokasi" };

export default async function LocationsPage() {
  const actor = await requireActor();
  const res = await load(() => listLocations(db, actor));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const canManage = can(actor, "property.manage");
  return (
    <>
      <PageHeader title="Lokasi / Klaster" subtitle="Pengelompokan villa berdasarkan area geografis." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {res.data.length === 0 ? <Empty title="Belum ada lokasi" /> : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead><tr><th>Kode</th><th>Lokasi</th><th>Area</th><th>Villa</th><th>PIC Lokasi</th><th></th></tr></thead>
                <tbody>
                  {res.data.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs">{l.code}</td>
                      <td><Link className="link font-medium" href={`/lokasi/${l.id}`}>{l.name}</Link> <DemoBadge show={l.isDemo} /></td>
                      <td>{l.area ?? "—"}</td>
                      <td><Link className="link tabular-nums" href={`/properti?location=${l.id}`}>{l.villaCount}</Link></td>
                      <td>{l.pics.length ? l.pics.join(", ") : <span className="text-slate-400">—</span>}</td>
                      <td>{!l.isActive && <Badge>Nonaktif</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {canManage && (
          <Card title="Tambah lokasi">
            <ActionForm action={createLocationAction}>
              <Field label="Kode *" name="code" hint="Contoh: UBD, CNG"><input id="code" name="code" className="input uppercase" required /></Field>
              <Field label="Nama lokasi *" name="name"><input id="name" name="name" className="input" required /></Field>
              <Field label="Area" name="area"><input id="area" name="area" className="input" /></Field>
              <Field label="Catatan" name="notes"><textarea id="notes" name="notes" rows={2} className="input" /></Field>
              <SubmitButton>Simpan lokasi</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
