import { ActionForm, SubmitButton } from "./forms";
import { Field } from "./ui";
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABEL } from "@/services/properties";
import type { ActionState } from "@/lib/action";

type P = { id?: string; code?: string; name?: string; locationId?: string; address?: string | null; status?: string; bedrooms?: number; bathrooms?: number; maxGuests?: number | null; notes?: string | null };

export function PropertyForm({ action, locations, p = {}, submit }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; locations: { id: string; name: string }[]; p?: P; submit: string }) {
  return (
    <ActionForm action={action} className="card space-y-4 p-4 sm:p-6">
      {p.id && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama villa *" name="name"><input id="name" name="name" className="input" defaultValue={p.name} required /></Field>
        <Field label="Kode villa" name="code" hint="Kosongkan untuk dibuat otomatis (VL-001…)"><input id="code" name="code" className="input uppercase" defaultValue={p.code} /></Field>
        <Field label="Lokasi / klaster *" name="locationId">
          <select id="locationId" name="locationId" className="input" defaultValue={p.locationId} required>
            <option value="">— Pilih lokasi —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Status properti *" name="status">
          <select id="status" name="status" className="input" defaultValue={p.status ?? "active"}>
            {PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{PROPERTY_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Kamar tidur *" name="bedrooms"><input id="bedrooms" name="bedrooms" type="number" min={0} inputMode="numeric" className="input" defaultValue={p.bedrooms ?? 1} required /></Field>
        <Field label="Kamar mandi *" name="bathrooms"><input id="bathrooms" name="bathrooms" type="number" min={0} inputMode="numeric" className="input" defaultValue={p.bathrooms ?? 1} required /></Field>
        <Field label="Kapasitas tamu" name="maxGuests"><input id="maxGuests" name="maxGuests" type="number" min={0} inputMode="numeric" className="input" defaultValue={p.maxGuests ?? ""} /></Field>
      </div>
      <Field label="Alamat lengkap" name="address"><textarea id="address" name="address" rows={2} className="input" defaultValue={p.address ?? ""} /></Field>
      <Field label="Catatan operasional" name="notes"><textarea id="notes" name="notes" rows={4} className="input" defaultValue={p.notes ?? ""} /></Field>
      <div className="flex justify-end"><SubmitButton>{submit}</SubmitButton></div>
    </ActionForm>
  );
}
