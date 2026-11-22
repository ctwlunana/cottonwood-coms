import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { listSettings } from "@/services/settings";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime, fmtIDR } from "@/lib/format";
import { saveSettingAction } from "../actions";

export const metadata = { title: "Pengaturan sistem" };

export default async function SystemSettings() {
  const actor = await requireActor();
  const res = await load(() => listSettings(db, actor));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const canApproval = can(actor, "approval.rule_manage");
  return (
    <>
      <PageHeader title="Pengaturan sistem" back={{ href: "/pengaturan", label: "Pengaturan" }} />
      <div className="grid gap-4 lg:grid-cols-2">
        {res.data.map((s) => {
          const locked = s.key.startsWith("approval.") && !canApproval;
          return (
            <Card key={s.key} title={s.label} actions={s.updatedAt && <span className="text-xs text-slate-400">diubah {fmtDateTime(s.updatedAt)}</span>}>
              <ActionForm action={saveSettingAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="key" value={s.key} />
                {s.key === "notification.quiet_hours" ? (
                  <>
                    <input type="time" name="start" defaultValue={(s.value as { start?: string } | null)?.start ?? ""} className="input w-32" aria-label="Mulai" />
                    <span className="pb-2">–</span>
                    <input type="time" name="end" defaultValue={(s.value as { end?: string } | null)?.end ?? ""} className="input w-32" aria-label="Selesai" />
                  </>
                ) : typeof s.value === "number" ? (
                  <input name="value" inputMode="numeric" defaultValue={String(s.value)} className="input w-48" disabled={locked} />
                ) : (
                  <input name="value" defaultValue={String(s.value)} className="input min-w-0 flex-1" />
                )}
                {!locked && <SubmitButton className="btn-secondary">Simpan</SubmitButton>}
                {s.key === "approval.gm_threshold_idr" && <p className="w-full text-xs text-slate-500">Saat ini: {fmtIDR(s.value as number)}. {locked && "Hanya GM yang dapat mengubah."} Digunakan oleh aturan approval (Tahap 5).</p>}
              </ActionForm>
            </Card>
          );
        })}
        <Card title="Komunikasi">
          <p className="text-sm text-slate-600">Seluruh komunikasi operasional dilakukan di dalam COMS (notifikasi in-app). WhatsApp dan email tidak digunakan.</p>
        </Card>
      </div>
    </>
  );
}
