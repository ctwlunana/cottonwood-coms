import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { requirePermission } from "@/lib/authz";
import { listEquipment, listPmSchedules, engineersForPicker } from "@/services/maintenance";
import { listProperties } from "@/services/properties";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { fmtDate } from "@/lib/format";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/labels";
import { equipmentAction, pmAction } from "../actions";

export const metadata = { title: "Preventif & peralatan" };

export default async function PreventivePage() {
  const actor = await requireActor();
  const res = await load(async () => {
    requirePermission(actor, "maintenance.pm_manage");
    return Promise.all([listPmSchedules(db, actor), listEquipment(db, actor), listProperties(db, actor), engineersForPicker(db, actor)]);
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [pms, eqs, villas, engineers] = res.data;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const villaSelect = <select name="propertyId" className="input" required defaultValue=""><option value="" disabled>— Villa —</option>{villas.rows.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>;
  const catSelect = <select name="category" className="input" required defaultValue=""><option value="" disabled>— Kategori —</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>;
  return (
    <>
      <PageHeader title="Preventif & peralatan" back={{ href: "/maintenance", label: "Maintenance" }}
        subtitle="Work order preventif dibuat otomatis 3 hari sebelum jatuh tempo; jadwal maju otomatis setelah work order ditutup." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Jadwal preventif (${pms.length})`}>
            {pms.length === 0 ? <Empty title="Belum ada jadwal" /> : (
              <ul className="divide-y divide-slate-100">
                {pms.map(({ pm, villa, equipment, openWo }) => (
                  <li key={pm.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className={pm.isActive ? "" : "text-slate-400"}><b>{pm.title}</b> · {villa}{equipment && ` · ${equipment}`}
                      <span className="block text-xs text-slate-500">Setiap {pm.intervalDays} hari · jatuh tempo {fmtDate(pm.nextDueOn)} · terakhir {fmtDate(pm.lastDoneOn)}</span></span>
                    <span className="flex items-center gap-2">
                      {pm.nextDueOn <= today && pm.isActive && <Badge tone="red">Jatuh tempo</Badge>}
                      {openWo && <Link href={`/maintenance/${openWo}`} className="link text-xs">WO terbuka</Link>}
                      <ConfirmButton action={pmAction} hidden={{ op: "toggle", id: pm.id, active: pm.isActive ? "0" : "1" }} label={pm.isActive ? "Nonaktifkan" : "Aktifkan"} className="btn-ghost text-xs" confirm="Ubah status jadwal?" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Peralatan (${eqs.length})`}>
            {eqs.length === 0 ? <Empty title="Belum ada data peralatan" /> : (
              <div className="overflow-x-auto"><table className="table"><thead><tr><th>Villa</th><th>Peralatan</th><th>Kategori</th><th>Merek / model</th><th>Dipasang</th></tr></thead>
                <tbody>{eqs.map(({ e, villa }) => <tr key={e.id}><td>{villa}</td><td>{e.name}<div className="text-xs text-slate-400">{e.serialNo}</div></td><td>{CATEGORY_LABEL[e.category]}</td><td>{[e.brand, e.model].filter(Boolean).join(" ") || "—"}</td><td>{fmtDate(e.installedOn)}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Jadwal preventif baru">
            <ActionForm action={pmAction} resetOnSuccess>
              {villaSelect}
              <input name="title" className="input" placeholder="mis. Servis AC semua kamar" required />
              {catSelect}
              <select name="equipmentId" className="input" defaultValue=""><option value="">— Peralatan (opsional) —</option>{eqs.map(({ e, villa }) => <option key={e.id} value={e.id}>{villa}: {e.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-2"><input name="intervalDays" type="number" min={1} className="input" placeholder="Interval (hari)" required /><input name="nextDueOn" type="date" className="input" required defaultValue={today} /></div>
              <select name="defaultAssigneeId" className="input" defaultValue=""><option value="">— Engineer default —</option>{engineers.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</select>
              <textarea name="instructions" rows={2} className="input" placeholder="Instruksi pekerjaan" />
              <SubmitButton className="btn-primary w-full">Simpan jadwal</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Tambah peralatan">
            <ActionForm action={equipmentAction} resetOnSuccess>
              {villaSelect}
              <input name="name" className="input" placeholder="mis. AC kamar utama" required />
              {catSelect}
              <div className="grid grid-cols-2 gap-2"><input name="brand" className="input" placeholder="Merek" /><input name="model" className="input" placeholder="Model" /></div>
              <input name="serialNo" className="input" placeholder="No. seri" />
              <input name="installedOn" type="date" className="input" aria-label="Tanggal dipasang" />
              <SubmitButton className="btn-secondary w-full">Simpan peralatan</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
