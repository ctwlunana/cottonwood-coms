import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { reportableVillas } from "@/services/maintenance";
import { PageHeader, Field, Empty } from "@/components/ui";
import { ActionForm, SubmitButton, PhotoInput } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/labels";
import { reportAction } from "../actions";

export const metadata = { title: "Lapor kerusakan" };

const PRIO_HELP = [
  ["critical", "Kritis", "Bocor besar, bahaya listrik, AC mati di villa berisi tamu"],
  ["high", "Tinggi", "Mengganggu kenyamanan tamu secara signifikan"],
  ["normal", "Normal", "Perbaikan rutin"],
  ["low", "Rendah", "Kosmetik / tidak mendesak"],
] as const;

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ villa?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(() => reportableVillas(db, actor));
  if (!res.ok) return <Forbidden message={res.denied} />;
  if (!res.data.length) return <Empty title="Tidak ada villa yang dapat Anda laporkan" />;
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");
  return (
    <>
      <PageHeader title="Lapor kerusakan / masalah" back={{ href: "/maintenance", label: "Maintenance" }} subtitle="Laporan langsung diterima Supervisor Engineer untuk ditinjau." />
      <ActionForm action={reportAction} className="card space-y-4 p-4 sm:p-6">
        <Field label="Villa *" name="propertyId">
          <select id="propertyId" name="propertyId" className="input" defaultValue={sp.villa ?? ""} required>
            <option value="" disabled>— Pilih villa —</option>
            {res.data.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Kategori masalah *" name="category">
          <select id="category" name="category" className="input" defaultValue="" required>
            <option value="" disabled>— Pilih —</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="label">Prioritas *</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRIO_HELP.map(([v, l, h]) => (
              <label key={v} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                <input type="radio" name="priority" value={v} defaultChecked={v === "normal"} className="mt-1" />
                <span className="text-sm"><b>{l}</b><span className="block text-xs text-slate-500">{h}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Deskripsi masalah *" name="description"><textarea id="description" name="description" rows={4} className="input" required minLength={5} placeholder="Apa masalahnya, di mana lokasinya (kamar/area)…" /></Field>
        <Field label="Waktu ditemukan" name="discoveredAt"><input id="discoveredAt" name="discoveredAt" type="datetime-local" className="input" defaultValue={now} /></Field>
        <div><span className="label">Foto</span><PhotoInput /></div>
        <SubmitButton className="btn-primary w-full sm:w-auto" pendingText="Mengirim…">Kirim laporan</SubmitButton>
      </ActionForm>
    </>
  );
}
