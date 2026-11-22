import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getLocation } from "@/services/properties";
import { usersWithRoles } from "@/services/lookup";
import { PageHeader, Card, Field, Empty } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { fmtDate } from "@/lib/format";
import { updateLocationAction, assignLocationAction, endLocationAssignmentAction } from "../actions";

const KIND = { location_pic: "PIC Lokasi", hk_team_leader: "Team Leader HK" } as const;

export default async function LocationDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getLocation(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { location: l, assigned } = res.data;
  const canManage = can(actor, "property.manage"), canAssign = can(actor, "property.assign");
  const [pics, tls] = canAssign ? await Promise.all([usersWithRoles(db, ["location_pic", "supervisor_villa"]), usersWithRoles(db, ["hk_team_leader", "hk_coordinator"])]) : [[], []];
  return (
    <>
      <PageHeader title={l.name} subtitle={<><span className="font-mono">{l.code}</span> · <Link className="link" href={`/properti?location=${l.id}`}>Lihat villa di lokasi ini</Link></>} back={{ href: "/lokasi", label: "Lokasi" }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Data lokasi">
          {canManage ? (
            <ActionForm action={updateLocationAction}>
              <input type="hidden" name="id" value={l.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kode *" name="code"><input id="code" name="code" className="input uppercase" defaultValue={l.code} required /></Field>
                <Field label="Nama *" name="name"><input id="name" name="name" className="input" defaultValue={l.name} required /></Field>
              </div>
              <Field label="Area" name="area"><input id="area" name="area" className="input" defaultValue={l.area ?? ""} /></Field>
              <Field label="Catatan" name="notes"><textarea id="notes" name="notes" rows={3} className="input" defaultValue={l.notes ?? ""} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" value="1" defaultChecked={l.isActive} /> Lokasi aktif</label>
              <SubmitButton>Simpan</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm">{l.area ?? "—"}<br />{l.notes}</p>}
        </Card>
        <Card title="PIC & Team Leader">
          <p className="mb-3 text-xs text-slate-500">PIC Lokasi dapat melihat seluruh villa di klaster ini. Penugasan ini <b>tidak</b> memberi otoritas keuangan.</p>
          {assigned.length === 0 ? <Empty title="Belum ada PIC" /> : (
            <ul className="space-y-2">
              {assigned.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span><b>{a.fullName}</b> <span className="text-xs text-slate-500">· {KIND[a.kind]} · sejak {fmtDate(a.startedAt)}</span></span>
                  {canAssign && <ConfirmButton action={endLocationAssignmentAction} hidden={{ assignmentId: a.id, locationId: l.id }} label="Akhiri" className="btn-ghost text-xs" confirm={`Akhiri penugasan ${a.fullName}?`} />}
                </li>
              ))}
            </ul>
          )}
          {canAssign && (
            <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
              {([["location_pic", pics], ["hk_team_leader", tls]] as const).map(([kind, list]) => (
                <ActionForm key={kind} action={assignLocationAction} className="space-y-2">
                  <input type="hidden" name="locationId" value={l.id} /><input type="hidden" name="kind" value={kind} />
                  <label className="label">Tambah {KIND[kind]}</label>
                  <select name="userId" className="input" required defaultValue="">
                    <option value="" disabled>— Pilih —</option>
                    {list.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary w-full">Tambah</SubmitButton>
                </ActionForm>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
