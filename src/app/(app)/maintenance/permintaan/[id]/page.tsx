import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getRequest, engineersForPicker } from "@/services/maintenance";
import { PageHeader, Card, DL, Badge, Field } from "@/components/ui";
import { PriorityBadge, WoStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PhotoGrid } from "@/components/photos";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { CATEGORY_LABEL, MR_STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";
import { reviewAction } from "../../actions";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ baru?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const res = await load(() => getRequest(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { request: r, villa, location, reporter, photos, openWorkOrders, history } = res.data;
  const canReview = can(actor, "maintenance.review") && r.status === "pending_review";
  const engineers = canReview ? await engineersForPicker(db, actor) : [];
  return (
    <>
      <PageHeader back={{ href: canReview ? "/maintenance?tab=permintaan" : "/maintenance?tab=saya", label: "Maintenance" }}
        title={`${r.code} — ${villa.name}`} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone="blue">{MR_STATUS_LABEL[r.status]}</Badge><PriorityBadge p={r.priority} />{CATEGORY_LABEL[r.category]}</span>} />
      {sp.baru && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Laporan terkirim ke Supervisor Engineer. Anda akan mendapat notifikasi saat ditindaklanjuti.</div>}
      {r.repeatCount >= 2 && <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">Masalah berulang: {r.repeatCount} kejadian {CATEGORY_LABEL[r.category]} di villa ini dalam 90 hari terakhir.</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Laporan">
            <p className="whitespace-pre-wrap text-sm">{r.description}</p>
            <div className="mt-4"><DL items={[["Villa", <Link key="v" className="link" href={`/properti/${villa.id}`}>{villa.name}</Link>], ["Lokasi", location], ["Dilaporkan oleh", reporter], ["Ditemukan", fmtDateTime(r.discoveredAt)], ["Dikirim", fmtDateTime(r.createdAt)], ["Sumber", r.source]]} /></div>
            {r.reviewNote && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><b>Catatan peninjau:</b> {r.reviewNote}</p>}
            {r.workOrderId && <p className="mt-3"><Link className="btn-secondary" href={`/maintenance/${r.workOrderId}`}>Buka work order →</Link></p>}
          </Card>
          <Card title="Foto"><PhotoGrid files={photos} /></Card>
          {history.length > 0 && (
            <Card title={`Riwayat ${CATEGORY_LABEL[r.category]} di villa ini (90 hari)`}>
              <ul className="space-y-1 text-sm">{history.map((h) => <li key={h.id}><Link className="link" href={`/maintenance/${h.id}`}>{h.code}</Link> {h.title} · {fmtDate(h.reportedAt)} <WoStatusBadge s={h.status} /></li>)}</ul>
            </Card>
          )}
        </div>
        {canReview && (
          <div className="order-first space-y-4 lg:order-none">
            <Card title="Jadikan work order">
              <ActionForm action={reviewAction}>
                <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="action" value="convert" />
                <Field label="Judul pekerjaan *" name="title"><input id="title" name="title" className="input" required defaultValue={`${CATEGORY_LABEL[r.category]}: ${r.description.slice(0, 60)}`} /></Field>
                <Field label="Prioritas" name="priority"><select id="priority" name="priority" className="input" defaultValue={r.priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
                <Field label="Engineer" name="assignTo"><select id="assignTo" name="assignTo" className="input" defaultValue=""><option value="">— Tugaskan nanti —</option>{engineers.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.open} WO aktif</option>)}</select></Field>
                <Field label="atau vendor eksternal" name="vendorName"><input id="vendorName" name="vendorName" className="input" placeholder="Nama vendor" /></Field>
                <Field label="Batas waktu" name="deadline" hint="Kosongkan = otomatis sesuai prioritas"><input id="deadline" name="deadline" type="datetime-local" className="input" /></Field>
                <Field label="Estimasi biaya (Rp)" name="estimatedCost"><input id="estimatedCost" name="estimatedCost" inputMode="numeric" className="input" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="keeperConfirmationRequired" value="1" defaultChecked /> Perlu konfirmasi Villa Keeper sebelum ditutup</label>
                <Field label="Catatan" name="note"><textarea id="note" name="note" rows={2} className="input" /></Field>
                <SubmitButton className="btn-primary w-full">Buat work order</SubmitButton>
              </ActionForm>
            </Card>
            {openWorkOrders.length > 0 && (
              <Card title="Gabungkan (duplikat)">
                <ActionForm action={reviewAction}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="action" value="merge" />
                  <select name="workOrderId" className="input" required defaultValue="">
                    <option value="" disabled>— Work order terbuka di villa ini —</option>
                    {openWorkOrders.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.title}</option>)}
                  </select>
                  <input name="note" className="input" placeholder="Catatan (opsional)" />
                  <SubmitButton className="btn-secondary w-full">Gabungkan</SubmitButton>
                </ActionForm>
              </Card>
            )}
            <Card title="Tolak laporan">
              <ActionForm action={reviewAction} confirm="Tolak laporan ini? Pelapor akan diberi tahu.">
                <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="action" value="reject" />
                <textarea name="note" rows={2} className="input" required minLength={5} placeholder="Alasan (wajib)" />
                <SubmitButton className="btn-secondary w-full">Tolak</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
