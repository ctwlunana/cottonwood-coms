import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getProperty } from "@/services/properties";
import { usersWithRoles } from "@/services/lookup";
import { PageHeader, Card, DL, Badge, DemoBadge, Empty } from "@/components/ui";
import { PropertyStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton, ConfirmButton, PhotoInput } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { AuditList } from "@/components/audit-list";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { assignPropertyAction, endPropertyAssignmentAction, archivePropertyAction, uploadPropertyPhotosAction, removePhotoAction } from "../actions";

const KIND = { villa_keeper: "Villa Keeper", inspector: "Inspektur kesiapan" } as const;

export default async function PropertyDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getProperty(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { property: p, location, assignments, locationPics, history, photos } = res.data;
  const canManage = can(actor, "property.manage");
  const canAssign = can(actor, "property.assign");
  const active = assignments.filter((a) => !a.endedAt);
  const keeper = active.find((a) => a.kind === "villa_keeper");
  const candidates = canAssign ? await usersWithRoles(db, ["villa_keeper", "location_pic", "supervisor_villa"]) : [];
  const inspectorCandidates = canAssign ? await usersWithRoles(db, ["villa_keeper", "location_pic", "supervisor_villa", "hk_team_leader", "hk_coordinator"]) : [];

  return (
    <>
      <PageHeader
        back={{ href: "/properti", label: "Properti" }}
        title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{p.code}</span> · <Link className="link" href={`/lokasi/${location.id}`}>{location.name}</Link> <PropertyStatusBadge status={p.status} /> <DemoBadge show={p.isDemo} />{p.deletedAt && <Badge tone="red">Diarsipkan</Badge>}</span>}
        actions={canManage && <>
          <Link href={`/properti/${p.id}/edit`} className="btn-secondary">Ubah data</Link>
          <ConfirmButton action={archivePropertyAction} hidden={{ id: p.id, archived: p.deletedAt ? "0" : "1" }}
            label={p.deletedAt ? "Pulihkan" : "Arsipkan"} confirm={p.deletedAt ? "Pulihkan villa ini?" : "Arsipkan villa ini? Riwayat tetap tersimpan, villa tidak tampil di daftar aktif."} />
        </>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Data villa">
            <DL items={[
              ["Kamar tidur / mandi", `${p.bedrooms} / ${p.bathrooms}`],
              ["Kapasitas tamu", p.maxGuests ?? "—"],
              ["Alamat", p.address ?? "—"],
              ["Villa Keeper", keeper ? keeper.fullName : <span className="font-medium text-red-600">Belum ada</span>],
              ["PIC Lokasi", locationPics.map((x) => x.fullName).join(", ") || "—"],
              ["Terakhir diperbarui", fmtDateTime(p.updatedAt)],
            ]} />
            {p.notes && <div className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{p.notes}</div>}
          </Card>

          <Card title={`Foto (${photos.length})`}>
            {photos.length === 0 ? <p className="text-sm text-slate-500">Belum ada foto.</p> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {photos.map((ph) => (
                  <figure key={ph.id} className="space-y-1">
                    <a href={`/api/attachments/${ph.id}`} target="_blank" rel="noreferrer">
                      {ph.mime.startsWith("image/") && ph.mime !== "image/heic"
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/attachments/${ph.id}`} alt={ph.originalName ?? "Foto villa"} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                        : <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-xs">{ph.originalName}</div>}
                    </a>
                    {canManage && <ConfirmButton action={removePhotoAction} hidden={{ attachmentId: ph.id, propertyId: p.id }} label="Hapus" className="btn-ghost w-full text-xs" confirm="Sembunyikan foto ini? (tetap tercatat di audit)" />}
                  </figure>
                ))}
              </div>
            )}
            {canManage && (
              <ActionForm action={uploadPropertyPhotosAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" resetOnSuccess>
                <input type="hidden" name="propertyId" value={p.id} />
                <PhotoInput />
                <SubmitButton className="btn-secondary" pendingText="Mengunggah…">Unggah foto</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card title="Riwayat operasional & perubahan">
            <AuditList rows={history.map((h) => ({ id: h.id, action: h.action, at: h.at, user: h.user, before: h.before, after: h.after }))} />
            <p className="mt-3 text-xs text-slate-500">Riwayat maintenance, housekeeping, checklist, dan stok villa akan tampil di sini setelah modul terkait aktif.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Penugasan">
            {active.length === 0 ? <Empty title="Belum ada penugasan" /> : (
              <ul className="space-y-3">
                {active.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 text-sm">
                    <div><div className="font-medium">{a.fullName}</div><div className="text-xs text-slate-500">{KIND[a.kind]} · sejak {fmtDate(a.startedAt)}</div></div>
                    {canAssign && <ConfirmButton action={endPropertyAssignmentAction} hidden={{ assignmentId: a.id, propertyId: p.id }} label="Akhiri" className="btn-ghost text-xs" confirm={`Akhiri penugasan ${a.fullName}?`} />}
                  </li>
                ))}
              </ul>
            )}
            {canAssign && !p.deletedAt && (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                <ActionForm action={assignPropertyAction} className="space-y-2" confirm={keeper ? `Ganti Villa Keeper ${keeper.fullName}?` : undefined}>
                  <input type="hidden" name="propertyId" value={p.id} /><input type="hidden" name="kind" value="villa_keeper" />
                  <label className="label">{keeper ? "Ganti Villa Keeper" : "Tetapkan Villa Keeper"}</label>
                  <select name="userId" className="input" required defaultValue="">
                    <option value="" disabled>— Pilih karyawan —</option>
                    {candidates.filter((c) => c.id !== keeper?.userId).map((c) => <option key={c.id} value={c.id}>{c.fullName} ({c.employeeCode})</option>)}
                  </select>
                  <SubmitButton className="btn-primary w-full">Simpan</SubmitButton>
                </ActionForm>
                <ActionForm action={assignPropertyAction} className="space-y-2">
                  <input type="hidden" name="propertyId" value={p.id} /><input type="hidden" name="kind" value="inspector" />
                  <label className="label">Tambah inspektur kesiapan</label>
                  <select name="userId" className="input" required defaultValue="">
                    <option value="" disabled>— Pilih karyawan —</option>
                    {inspectorCandidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                  <SubmitButton className="btn-secondary w-full">Tambah</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
          {assignments.some((a) => a.endedAt) && (
            <Card title="Riwayat penugasan">
              <ul className="space-y-2 text-sm">
                {assignments.filter((a) => a.endedAt).map((a) => (
                  <li key={a.id}><span className="font-medium">{a.fullName}</span> <span className="text-xs text-slate-500">· {KIND[a.kind]} · {fmtDate(a.startedAt)} – {fmtDate(a.endedAt)}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
