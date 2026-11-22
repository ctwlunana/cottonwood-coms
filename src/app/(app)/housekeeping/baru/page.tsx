import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { requirePermission } from "@/lib/authz";
import { listTeams, dailySummary } from "@/services/housekeeping";
import { listProperties } from "@/services/properties";
import { todayJakarta } from "@/services/villa-relations";
import { PageHeader, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";
import { createAssignmentAction } from "../actions";

export const metadata = { title: "Jadwalkan pembersihan" };

export default async function NewAssignment({ searchParams }: { searchParams: Promise<{ date?: string; villa?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayJakarta();
  const res = await load(async () => {
    requirePermission(actor, "housekeeping.schedule");
    return Promise.all([listProperties(db, actor), listTeams(db, actor), dailySummary(db, actor, date)]);
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [villas, teams, summary] = res.data;
  const busy = new Set(summary.list.filter((r) => r.a.status !== "cancelled").map((r) => r.a.propertyId));
  return (
    <>
      <PageHeader title="Jadwalkan pembersihan" back={{ href: `/housekeeping?date=${date}`, label: "Housekeeping" }} />
      <ActionForm action={createAssignmentAction} className="card space-y-4 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Villa *" name="propertyId">
            <select id="propertyId" name="propertyId" className="input" required defaultValue={sp.villa ?? ""}>
              <option value="" disabled>— Pilih villa —</option>
              {villas.rows.map((v) => <option key={v.id} value={v.id} disabled={busy.has(v.id)}>{v.name}{busy.has(v.id) ? " (sudah dijadwalkan)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Tanggal checkout *" name="checkoutDate"><input id="checkoutDate" name="checkoutDate" type="date" className="input" defaultValue={date} required /></Field>
          <Field label="Target selesai *" name="expectedDoneAt" hint="Sebelum check-in berikutnya"><input id="expectedDoneAt" name="expectedDoneAt" type="datetime-local" className="input" defaultValue={`${date}T14:00`} required /></Field>
          <Field label="Prioritas" name="priority"><select id="priority" name="priority" className="input" defaultValue="normal">{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
          <Field label="Tim" name="teamId"><select id="teamId" name="teamId" className="input" defaultValue=""><option value="">— Tanpa tim —</option>{teams.map((t) => <option key={t.t.id} value={t.t.id}>{t.t.name}{t.location ? ` · ${t.location}` : ""}</option>)}</select></Field>
        </div>
        <Field label="Instruksi khusus" name="instructions"><textarea id="instructions" name="instructions" rows={2} className="input" placeholder="mis. ganti semua linen, tamu berikutnya membawa bayi" /></Field>
        <fieldset>
          <legend className="label">Petugas (boleh lebih dari satu; bisa ditugaskan nanti oleh Team Leader)</legend>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {summary.manpower.map((m) => (
              <label key={m.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <input type="checkbox" name="staffIds" value={m.id} /> {m.fullName} <span className="ml-auto text-xs text-slate-500">{m.tasks} tugas</span>
              </label>
            ))}
          </div>
        </fieldset>
        <SubmitButton>Simpan penugasan</SubmitButton>
      </ActionForm>
    </>
  );
}
