"use client";
import { useState } from "react";
import { ActionForm, SubmitButton, PhotoInput } from "./forms";
import type { ActionState } from "@/lib/action";

type Item = { id: string; label: string; section: string | null; photoRequiredOnFail: boolean };
const OPTS = [["yes", "Ya / Baik", "peer-checked:bg-emerald-600 peer-checked:text-white peer-checked:border-emerald-600"], ["no", "Bermasalah", "peer-checked:bg-red-600 peer-checked:text-white peer-checked:border-red-600"], ["na", "N/A", "peer-checked:bg-slate-600 peer-checked:text-white peer-checked:border-slate-600"]] as const;

export function ChecklistForm({ action, villas, templateId, items, defaultVilla }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>; villas: { id: string; name: string; done: boolean }[];
  templateId: string; items: Item[]; defaultVilla?: string;
}) {
  const [ans, setAns] = useState<Record<string, string>>({});
  const sections = [...new Set(items.map((i) => i.section ?? "Umum"))];
  const answered = Object.keys(ans).length;
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <div className="card p-4">
        <label className="label" htmlFor="propertyId">Villa</label>
        <select id="propertyId" name="propertyId" className="input" defaultValue={defaultVilla ?? ""} required>
          <option value="" disabled>— Pilih villa —</option>
          {villas.map((v) => <option key={v.id} value={v.id}>{v.name}{v.done ? " (sudah diisi hari ini)" : ""}</option>)}
        </select>
      </div>
      {sections.map((sec) => (
        <section key={sec} className="card divide-y divide-slate-100">
          <h2 className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{sec}</h2>
          {items.filter((i) => (i.section ?? "Umum") === sec).map((it) => (
            <div key={it.id} className="space-y-2 px-4 py-3">
              <p className="text-sm font-medium">{it.label}</p>
              <div className="grid grid-cols-3 gap-2">
                {OPTS.map(([v, label, cls]) => (
                  <label key={v} className="block">
                    <input type="radio" name={`a:${it.id}`} value={v} required className="peer sr-only" onChange={() => setAns((s) => ({ ...s, [it.id]: v }))} />
                    <span className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 text-center text-sm ${cls}`}>{label}</span>
                  </label>
                ))}
              </div>
              {ans[it.id] === "no" && (
                <div className="space-y-2 rounded-lg bg-red-50 p-3">
                  <textarea name={`n:${it.id}`} rows={2} required className="input" placeholder="Jelaskan masalahnya…" />
                  <div className="text-xs text-red-800">{it.photoRequiredOnFail ? "Foto wajib:" : "Foto (opsional):"}</div>
                  <PhotoInput name={`f:${it.id}`} />
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
      <div className="card p-4"><label className="label" htmlFor="notes">Catatan umum (opsional)</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3">
        <span className="text-sm text-slate-500">{answered}/{items.length} dijawab</span>
        <SubmitButton pendingText="Mengirim…">Kirim checklist</SubmitButton>
      </div>
    </ActionForm>
  );
}
