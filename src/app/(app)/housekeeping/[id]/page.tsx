import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getAssignment, dailySummary } from "@/services/housekeeping";
import { PageHeader, Card, DL, Badge } from "@/components/ui";
import { HkStatusBadge, PriorityBadge } from "@/components/badges";
import { ActionForm, SubmitButton, PhotoInput } from "@/components/forms";
import { PhotoGrid } from "@/components/photos";
import { Forbidden } from "@/components/forbidden";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";
import { hkAction } from "../actions";
import { Decision } from "@/components/decision";

function Op({ id, op, children, confirm, className }: { id: string; op: string; children: React.ReactNode; confirm?: string; className?: string }) {
  return (
    <ActionForm action={hkAction} confirm={confirm} className={className ?? "space-y-3"}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} />{children}
    </ActionForm>
  );
}

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getAssignment(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const d = res.data;
  const { a } = d;
  const canAssign = can(actor, "housekeeping.assign"), canSchedule = can(actor, "housekeeping.schedule");
  const open = !["ready", "cancelled"].includes(a.status);
  const manpower = canAssign && ["pending", "assigned", "inspection_failed", "reclean_required"].includes(a.status) ? (await dailySummary(db, actor, a.checkoutDate)).manpower : [];
  const staffIds = d.staff.map((s) => s.id);

  return (
    <>
      <PageHeader back={{ href: `/housekeeping?date=${a.checkoutDate}`, label: "Housekeeping" }} title={d.villa.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{a.code}</span><HkStatusBadge s={a.status} /><PriorityBadge p={a.priority} />{d.overdue && <Badge tone="red">Lewat target</Badge>}</span>} />

      <div className={`mb-4 rounded-lg border p-3 text-sm ${a.status === "ready" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
        {a.status === "pending" && "Menunggu penugasan petugas."}
        {a.status === "assigned" && "Menunggu petugas memulai pembersihan."}
        {a.status === "in_progress" && "Sedang dibersihkan."}
        {a.status === "inspection_required" && <>Pembersihan selesai — <b>menunggu inspeksi kesiapan</b> oleh Villa Keeper / inspektur / Team Leader HK. Villa <b>belum</b> siap.</>}
        {a.status === "inspection_failed" && "Inspeksi gagal — Koordinator/Team Leader perlu meminta pembersihan ulang."}
        {a.status === "reclean_required" && "Perlu dibersihkan ulang oleh petugas."}
        {a.status === "ready" && <>Villa <b>SIAP untuk tamu</b> sejak {fmtDateTime(a.readyAt)}.</>}
        {a.status === "cancelled" && `Dibatalkan: ${a.cancelledReason}`}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Detail">
            <DL items={[
              ["Villa", d.villa.name], ["Lokasi", d.location], ["Alamat", d.villa.address ?? "—"], ["Kamar", `${d.villa.bedrooms} KT / ${d.villa.bathrooms} KM`],
              ["Checkout", fmtDate(a.checkoutDate)], ["Target selesai", fmtDateTime(a.expectedDoneAt)], ["Tim", d.team ?? "—"],
              ["Petugas", d.staff.map((s) => s.fullName).join(", ") || "—"], ["Mulai", fmtDateTime(a.startedAt)], ["Pembersihan selesai", fmtDateTime(a.cleaningCompletedAt)],
            ]} />
            {a.instructions && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><b>Instruksi:</b> {a.instructions}</p>}
          </Card>
          <Card title="Foto hasil pembersihan"><PhotoGrid files={d.photos} /></Card>
          {d.inspections.length > 0 && (
            <Card title="Inspeksi">
              <ul className="space-y-3">
                {d.inspections.map(({ i, by }) => (
                  <li key={i.id} className="space-y-1 text-sm">
                    <div><Badge tone={i.result === "pass" ? "green" : "red"}>{i.result === "pass" ? "Lulus" : "Gagal"}</Badge> {by} · {fmtDateTime(i.at)}</div>
                    {i.notes && <p>{i.notes}</p>}
                    <PhotoGrid files={d.inspectionPhotos.filter((p) => p.entityId === i.id)} empty="" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Riwayat">
            <ol className="space-y-2">{d.events.map(({ e, by }) => <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm">{e.toStatus && <HkStatusBadge s={e.toStatus} />} {e.note}<div className="text-xs text-slate-400">{by ?? "Sistem"} · {fmtRelative(e.at)}</div></li>)}</ol>
          </Card>
        </div>

        <div className="space-y-4">
          {d.isStaff && ["assigned", "reclean_required"].includes(a.status) && (
            <Op id={id} op="start" className="card p-4"><SubmitButton className="btn-primary w-full py-3 text-base">Mulai bersihkan</SubmitButton></Op>
          )}
          {d.isStaff && a.status === "in_progress" && (
            <Card title="Selesai membersihkan">
              <Op id={id} op="complete">
                <div><span className="label">Foto hasil (wajib)</span><PhotoInput /></div>
                <textarea name="note" rows={2} className="input" placeholder="Catatan / barang rusak / kurang (opsional)" />
                <SubmitButton className="btn-primary w-full">Pembersihan selesai</SubmitButton>
                <p className="text-xs text-slate-500">Villa akan menunggu inspeksi sebelum dinyatakan siap.</p>
              </Op>
              <p className="mt-3 text-xs">Menemukan kerusakan? <Link className="link" href={`/maintenance/lapor?villa=${a.propertyId}`}>Lapor ke Engineering</Link></p>
            </Card>
          )}
          {a.status === "inspection_required" && d.canInspect && (
            <Card title="Inspeksi kesiapan villa">
              <Op id={id} op="inspect">
                <textarea name="note" rows={2} className="input" placeholder="Catatan (wajib jika gagal)" />
                <div><span className="label">Foto (wajib jika gagal)</span><PhotoInput /></div>
                <Decision name="result" options={[["pass", "Lulus — villa siap", "good"], ["fail", "Gagal", "bad"]]} />
                <SubmitButton className="btn-primary w-full">Simpan hasil inspeksi</SubmitButton>
              </Op>
            </Card>
          )}
          {canAssign && a.status === "inspection_failed" && (
            <Card title="Minta pembersihan ulang">
              <Op id={id} op="reclean">
                <input name="note" className="input" placeholder="Apa yang harus diperbaiki" required />
                <SubmitButton className="btn-primary w-full">Minta bersihkan ulang</SubmitButton>
              </Op>
            </Card>
          )}
          {manpower.length > 0 && (
            <Card title="Petugas">
              <Op id={id} op="staff">
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {manpower.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="staffIds" value={m.id} defaultChecked={staffIds.includes(m.id)} /> {m.fullName} <span className="ml-auto text-xs text-slate-500">{m.tasks}</span></label>
                  ))}
                </div>
                <SubmitButton className="btn-secondary w-full">Simpan petugas</SubmitButton>
              </Op>
            </Card>
          )}
          {canSchedule && open && (
            <Card title="Koordinator">
              <div className="order-first space-y-4 lg:order-none">
                <Op id={id} op="update">
                  <input name="expectedDoneAt" type="datetime-local" className="input" aria-label="Target selesai baru" />
                  <select name="priority" className="input" defaultValue={a.priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
                  <textarea name="instructions" rows={2} className="input" defaultValue={a.instructions ?? ""} placeholder="Instruksi" />
                  <SubmitButton className="btn-secondary w-full">Perbarui</SubmitButton>
                </Op>
                <Op id={id} op="cancel" confirm="Batalkan penugasan ini?">
                  <input name="note" className="input" placeholder="Alasan pembatalan (wajib)" required minLength={5} />
                  <SubmitButton className="btn-ghost w-full text-red-700">Batalkan</SubmitButton>
                </Op>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
