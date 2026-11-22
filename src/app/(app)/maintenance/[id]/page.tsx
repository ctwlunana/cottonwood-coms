import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can, scopeOf } from "@/lib/authz";
import { load } from "@/lib/page";
import { getWorkOrder, engineersForPicker } from "@/services/maintenance";
import { villaRelation } from "@/services/villa-relations";
import { PageHeader, Card, DL, Badge, Field } from "@/components/ui";
import { PriorityBadge, WoStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton, PhotoInput } from "@/components/forms";
import { PhotoGrid } from "@/components/photos";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime, fmtIDR, fmtRelative } from "@/lib/format";
import { CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, WO_STATUS_LABEL } from "@/lib/labels";
import { woAction } from "../actions";
import { Decision } from "@/components/decision";

function Op({ id, op, children, confirm, className }: { id: string; op: string; children: React.ReactNode; confirm?: string; className?: string }) {
  return (
    <ActionForm action={woAction} confirm={confirm} className={className ?? "space-y-3"}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} />
      {children}
    </ActionForm>
  );
}

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getWorkOrder(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const d = res.data;
  const { wo } = d;
  const isAssignee = wo.assignedTo === actor.id && can(actor, "maintenance.work");
  const canAssign = can(actor, "maintenance.assign");
  const canReview = can(actor, "maintenance.review");
  const activeWork = ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval"].includes(wo.status);
  const canVerify = wo.status === "completed" && can(actor, "maintenance.verify") && wo.assignedTo !== actor.id;
  let canConfirm = false;
  if (wo.status === "verified" && can(actor, "maintenance.keeper_confirm") && wo.assignedTo !== actor.id) {
    const rel = await villaRelation(db, actor.id, wo.propertyId);
    canConfirm = rel.isKeeper || rel.isInspector || rel.isLocationPic || scopeOf(actor, "property.view") === "all";
  }
  const engineers = canAssign && activeWork ? await engineersForPicker(db, actor) : [];
  const before = d.photos.filter((p) => p.kind === "before"), after = d.photos.filter((p) => p.kind === "after");

  return (
    <>
      <PageHeader back={{ href: "/maintenance", label: "Maintenance" }} title={wo.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{wo.code}</span><WoStatusBadge s={wo.status} /><PriorityBadge p={wo.priority} />
          {d.overdue && <Badge tone="red">Terlambat</Badge>}{wo.repeatIssue && <Badge tone="purple">Masalah berulang</Badge>}</span>} />

      {/* Next action banner: who must do what now */}
      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        {wo.status === "new" && <>Menunggu penugasan oleh Supervisor Engineer.</>}
        {wo.status === "assigned" && <>Menunggu <b>{d.names.assignee ?? wo.vendorName}</b> memulai pekerjaan.</>}
        {["in_progress", "waiting_parts", "waiting_approval"].includes(wo.status) && <>Sedang ditangani <b>{d.names.assignee ?? wo.vendorName}</b> — {WO_STATUS_LABEL[wo.status]}.</>}
        {wo.status === "completed" && <>Menunggu <b>verifikasi Supervisor Engineer</b>.</>}
        {wo.status === "verified" && <>Menunggu <b>konfirmasi Villa Keeper</b> bahwa villa sudah normal.</>}
        {wo.status === "closed" && <>Selesai dan ditutup {fmtDateTime(wo.closedAt)}.</>}
        {wo.status === "cancelled" && <>Dibatalkan: {wo.cancelledReason}</>}
        {wo.deadline && activeWork && <> Batas waktu: <b>{fmtDateTime(wo.deadline)}</b>.</>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Detail">
            <p className="whitespace-pre-wrap text-sm">{wo.description}</p>
            <div className="mt-4"><DL items={[
              ["Villa", <Link key="v" className="link" href={`/properti/${d.villa.id}`}>{d.villa.name}</Link>], ["Lokasi", d.location],
              ["Kategori", CATEGORY_LABEL[wo.category]], ["Peralatan", d.equipment?.name ?? "—"],
              ["Pelapor", d.names.reporter], ["Dilaporkan", fmtDateTime(wo.reportedAt)],
              ["Engineer / vendor", d.names.assignee ?? wo.vendorName ?? "—"], ["Supervisor", d.names.supervisor],
              ["Estimasi biaya", fmtIDR(wo.estimatedCost)], ["Biaya aktual", fmtIDR(wo.actualCost)],
              ["Material tercatat", fmtIDR(d.materialCost)], ["Diverifikasi", d.names.verifier ? `${d.names.verifier} · ${fmtDateTime(wo.verifiedAt)}` : "—"],
            ]} /></div>
            {d.request && <p className="mt-3 text-sm">Dari laporan <Link className="link" href={`/maintenance/permintaan/${d.request.id}`}>{d.request.code}</Link></p>}
          </Card>
          {(wo.findings || wo.repairNotes) && (
            <Card title="Hasil pekerjaan">
              <DL items={[["Temuan / penyebab", wo.findings], ["Catatan perbaikan", wo.repairNotes]]} />
            </Card>
          )}
          <Card title="Foto">
            <div className="space-y-4">
              {d.requestPhotos.length > 0 && <div><p className="mb-1 text-xs font-medium text-slate-500">Dari laporan</p><PhotoGrid files={d.requestPhotos} /></div>}
              <div><p className="mb-1 text-xs font-medium text-slate-500">Sebelum ({before.length})</p><PhotoGrid files={before} empty="Belum ada." /></div>
              <div><p className="mb-1 text-xs font-medium text-slate-500">Sesudah ({after.length})</p><PhotoGrid files={after} empty="Belum ada." /></div>
              {d.photos.some((p) => p.kind === "finding") && <div><p className="mb-1 text-xs font-medium text-slate-500">Temuan</p><PhotoGrid files={d.photos.filter((p) => p.kind === "finding")} /></div>}
            </div>
            {(isAssignee || canAssign) && ["assigned", "in_progress", "waiting_parts", "waiting_approval", "completed"].includes(wo.status) && (
              <Op id={id} op="photos" className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <select name="kind" className="input w-auto" defaultValue={wo.status === "assigned" ? "before" : "after"}><option value="before">Foto sebelum</option><option value="after">Foto sesudah</option><option value="finding">Foto temuan</option></select>
                <PhotoInput /><SubmitButton className="btn-secondary" pendingText="Mengunggah…">Unggah foto</SubmitButton>
              </Op>
            )}
          </Card>
          {d.materials.length > 0 && (
            <Card title="Material">
              <table className="table"><thead><tr><th>Material</th><th>Jumlah</th><th>Harga satuan</th></tr></thead>
                <tbody>{d.materials.map((m) => <tr key={m.id}><td>{m.description}</td><td>{Number(m.quantity)} {m.unit}</td><td>{fmtIDR(m.unitCost)}</td></tr>)}</tbody></table>
            </Card>
          )}
          <Card title="Riwayat">
            <ol className="space-y-3">
              {d.updates.map(({ u, by }) => (
                <li key={u.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                  {u.toStatus && <span className="mr-1"><WoStatusBadge s={u.toStatus} /></span>}
                  {u.note}<div className="text-xs text-slate-400">{by ?? "Sistem"} · {fmtRelative(u.at)}</div>
                </li>
              ))}
            </ol>
            <Op id={id} op="comment" className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <input name="note" className="input" placeholder="Tambah catatan…" required />
              <SubmitButton className="btn-secondary">Kirim</SubmitButton>
            </Op>
          </Card>
          {d.history.length > 0 && (
            <Card title={`Riwayat ${CATEGORY_LABEL[wo.category]} di villa ini (90 hari)`}>
              <ul className="space-y-1 text-sm">{d.history.map((h) => <li key={h.id}><Link className="link" href={`/maintenance/${h.id}`}>{h.code}</Link> {h.title} <WoStatusBadge s={h.status} /></li>)}</ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {isAssignee && ["assigned", "waiting_parts", "waiting_approval"].includes(wo.status) && (
            <Card title={wo.status === "assigned" ? "Mulai pekerjaan" : "Lanjutkan pekerjaan"}>
              <Op id={id} op={wo.status === "assigned" ? "start" : "resume"}>
                <div><span className="label">Foto SEBELUM perbaikan</span><PhotoInput /></div>
                <input name="note" className="input" placeholder="Catatan (opsional)" />
                <SubmitButton className="btn-primary w-full">{wo.status === "assigned" ? "Mulai kerjakan" : "Lanjutkan"}</SubmitButton>
              </Op>
            </Card>
          )}
          {isAssignee && wo.status === "in_progress" && (
            <>
              <Card title="Selesaikan pekerjaan">
                <Op id={id} op="complete">
                  <Field label="Temuan / penyebab *" name="findings"><textarea id="findings" name="findings" rows={2} className="input" required defaultValue={wo.findings ?? ""} /></Field>
                  <Field label="Catatan perbaikan *" name="repairNotes"><textarea id="repairNotes" name="repairNotes" rows={2} className="input" required defaultValue={wo.repairNotes ?? ""} /></Field>
                  <Field label="Biaya aktual (Rp)" name="actualCost"><input id="actualCost" name="actualCost" inputMode="numeric" className="input" /></Field>
                  <div><span className="label">Foto SESUDAH perbaikan</span><PhotoInput /></div>
                  <p className="text-xs text-slate-500">Wajib ada minimal 1 foto sebelum dan 1 foto sesudah.</p>
                  <SubmitButton className="btn-primary w-full">Tandai selesai</SubmitButton>
                </Op>
              </Card>
              <Card title="Catat material">
                <Op id={id} op="material">
                  <input name="description" className="input" placeholder="Nama material" required />
                  <div className="grid grid-cols-3 gap-2"><input name="quantity" inputMode="decimal" className="input" placeholder="Jml" required /><input name="unit" className="input" placeholder="Satuan" required /><input name="unitCost" inputMode="numeric" className="input" placeholder="Harga" /></div>
                  <SubmitButton className="btn-secondary w-full">Simpan material</SubmitButton>
                </Op>
              </Card>
              <Card title="Tertunda?">
                <Op id={id} op="waiting">
                  <select name="status" className="input"><option value="waiting_parts">Menunggu suku cadang</option><option value="waiting_approval">Menunggu persetujuan</option></select>
                  <input name="note" className="input" placeholder="Apa yang ditunggu? (wajib)" required />
                  <SubmitButton className="btn-secondary w-full">Simpan status</SubmitButton>
                </Op>
              </Card>
            </>
          )}
          {canVerify && (
            <Card title="Verifikasi hasil">
              <Op id={id} op="verify">
                <textarea name="note" rows={2} className="input" placeholder="Catatan (wajib jika ditolak)" />
                <Decision name="decision" options={[["approve", "Setujui", "good"], ["reject", "Kerjakan ulang", "bad"]]} />
                <SubmitButton className="btn-primary w-full">Simpan verifikasi</SubmitButton>
              </Op>
            </Card>
          )}
          {canConfirm && (
            <Card title="Konfirmasi kondisi villa">
              <Op id={id} op="confirm">
                <textarea name="note" rows={2} className="input" placeholder="Catatan (wajib jika masih bermasalah)" />
                <Decision name="decision" options={[["ok", "Sudah normal", "good"], ["no", "Masih bermasalah", "bad"]]} />
                <SubmitButton className="btn-primary w-full">Simpan konfirmasi</SubmitButton>
              </Op>
            </Card>
          )}
          {canAssign && activeWork && (
            <Card title={wo.assignedTo || wo.vendorName ? "Ganti penugasan" : "Tugaskan"}>
              <Op id={id} op="assign">
                <select name="assignTo" className="input" defaultValue={wo.assignedTo ?? ""}><option value="">— Engineer —</option>{engineers.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.open} WO aktif</option>)}</select>
                <input name="vendorName" className="input" placeholder="atau vendor eksternal" defaultValue={wo.vendorName ?? ""} />
                <Field label="Batas waktu" name="deadline"><input id="deadline" name="deadline" type="datetime-local" className="input" /></Field>
                <SubmitButton className="btn-primary w-full">Simpan penugasan</SubmitButton>
              </Op>
            </Card>
          )}
          {canReview && activeWork && (
            <Card title="Supervisor">
              <div className="order-first space-y-4 lg:order-none">
                <Op id={id} op="priority">
                  <select name="priority" className="input" defaultValue={wo.priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
                  <input name="note" className="input" placeholder="Alasan perubahan (wajib)" required />
                  <SubmitButton className="btn-secondary w-full">Ubah prioritas</SubmitButton>
                </Op>
                <Op id={id} op="estimate" className="flex gap-2">
                  <input name="estimatedCost" inputMode="numeric" className="input" placeholder="Estimasi biaya (Rp)" required defaultValue={wo.estimatedCost ?? ""} />
                  <SubmitButton className="btn-secondary">Simpan</SubmitButton>
                </Op>
                <Op id={id} op="cancel" confirm="Batalkan work order ini?">
                  <input name="note" className="input" placeholder="Alasan pembatalan (wajib)" required minLength={5} />
                  <SubmitButton className="btn-ghost w-full text-red-700">Batalkan work order</SubmitButton>
                </Op>
              </div>
            </Card>
          )}
          {d.assigneePhone && <p className="text-xs text-slate-500">Kontak engineer: {d.assigneePhone}</p>}
        </div>
      </div>
    </>
  );
}
