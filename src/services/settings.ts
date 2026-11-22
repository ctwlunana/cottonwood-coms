import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { systemSettings } from "@/db/schema";
import { type Actor, requirePermission } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";

/** Known settings with defaults and validators. Values are configurable at runtime. */
export const SETTING_DEFS: Record<string, { label: string; default: unknown; validate: (v: unknown) => string | null }> = {
  "org.name": { label: "Nama perusahaan", default: "Cottonwood Boutique Stays Indonesia", validate: (v) => (typeof v === "string" && v.trim() ? null : "Wajib diisi") },
  "org.timezone": { label: "Zona waktu operasional", default: "Asia/Jakarta", validate: (v) => (v === "Asia/Jakarta" || v === "Asia/Makassar" || v === "Asia/Jayapura" ? null : "Zona waktu tidak didukung") },
  "approval.gm_threshold_idr": { label: "Ambang approval GM (Rp)", default: 10_000_000, validate: (v) => (Number.isInteger(v) && (v as number) > 0 ? null : "Harus bilangan bulat positif") },
  "notification.quiet_hours": {
    label: "Jam tenang notifikasi non-urgent (HH:MM–HH:MM)", default: { start: "22:00", end: "07:00" },
    validate: (v) => {
      if (v === null) return null;
      const o = v as { start?: string; end?: string };
      return /^\d\d:\d\d$/.test(o?.start ?? "") && /^\d\d:\d\d$/.test(o?.end ?? "") ? null : "Format HH:MM";
    },
  },
  "session.idle_hours": { label: "Sesi berakhir jika tidak aktif (jam)", default: 12, validate: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 72 ? null : "1–72 jam") },
};

export async function getSetting<T>(tx: Tx, key: string, fallback?: T): Promise<T> {
  const [row] = await tx.select().from(systemSettings).where(eq(systemSettings.key, key));
  if (row) return row.value as T;
  if (fallback !== undefined) return fallback;
  return SETTING_DEFS[key]?.default as T;
}

export async function listSettings(tx: Tx, actor: Actor) {
  requirePermission(actor, "settings.manage");
  const rows = await tx.select().from(systemSettings);
  return Object.entries(SETTING_DEFS).map(([key, def]) => {
    const r = rows.find((x) => x.key === key);
    return { key, label: def.label, value: r ? r.value : def.default, updatedAt: r?.updatedAt ?? null };
  });
}

export async function setSetting(tx: Tx, actor: Actor, key: string, value: unknown) {
  requirePermission(actor, "settings.manage");
  const def = SETTING_DEFS[key];
  if (!def) throw new ValidationError("Pengaturan tidak dikenal.");
  if (key.startsWith("approval.")) requirePermission(actor, "approval.rule_manage", "Ambang approval hanya dapat diubah oleh pemegang otoritas aturan approval.");
  const err = def.validate(value);
  if (err) throw new ValidationError(`${def.label}: ${err}`);
  const before = await getSetting(tx, key);
  await tx.insert(systemSettings).values({ key, value: value as object, updatedBy: actor.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(tx, actor, { action: "setting.update", entityType: "system_setting", entityId: key, before: { value: before }, after: { value } });
}
