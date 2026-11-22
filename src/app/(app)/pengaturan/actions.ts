"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { runAction, str, type ActionState } from "@/lib/action";
import { setSetting, SETTING_DEFS } from "@/services/settings";
import { setRolePermission, createRole } from "@/services/rbac";
import { createDepartment, updateDepartment } from "@/services/departments";
import { importVillas, importEmployees } from "@/services/imports";
import { rolePermissions } from "@/db/schema";
import { PERMISSION_CODES, SCOPES, type Scope } from "@/lib/permissions";
import { ValidationError } from "@/lib/errors";

export async function saveSettingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const key = str(fd, "key");
  const r = await runAction(async (actor, tx) => {
    const def = SETTING_DEFS[key];
    if (!def) throw new ValidationError("Pengaturan tidak dikenal.");
    let value: unknown = str(fd, "value");
    if (typeof def.default === "number") value = Number(String(value).replace(/[^\d]/g, ""));
    if (key === "notification.quiet_hours") value = str(fd, "start") && str(fd, "end") ? { start: str(fd, "start"), end: str(fd, "end") } : null;
    await setSetting(tx, actor, key, value);
    return { ok: true, message: "Tersimpan." };
  });
  revalidatePath("/pengaturan/sistem");
  return r;
}

/** Apply all changed cells of one role's permission row in a single transaction (all-or-nothing). */
export async function saveRolePermissionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const roleId = str(fd, "roleId");
  const r = await runAction(async (actor, tx) => {
    const current = new Map((await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((g) => [g.permissionCode, g.scope]));
    let changed = 0;
    for (const code of PERMISSION_CODES) {
      const raw = str(fd, `p:${code}`);
      const next: Scope | null = raw && (SCOPES as readonly string[]).includes(raw) ? (raw as Scope) : null;
      if ((current.get(code) ?? null) === next) continue;
      await setRolePermission(tx, actor, roleId, code, next);
      changed++;
    }
    return { ok: true, message: changed ? `${changed} perubahan hak akses disimpan.` : "Tidak ada perubahan." };
  });
  revalidatePath(`/pengaturan/peran/${roleId}`);
  return r;
}

export async function createRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => ({ ok: true, data: (await createRole(tx, actor, { slug: str(fd, "slug"), name: str(fd, "name"), description: str(fd, "description") })).id }));
  if (r?.ok) redirect(`/pengaturan/peran/${r.data}`);
  return r;
}

export async function createDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await createDepartment(tx, actor, { code: str(fd, "code"), name: str(fd, "name") }); return { ok: true, message: "Departemen dibuat." }; });
  revalidatePath("/pengaturan/departemen");
  return r;
}
export async function updateDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    await updateDepartment(tx, actor, str(fd, "id"), { code: str(fd, "code"), name: str(fd, "name"), isActive: fd.get("isActive") === "1" });
    return { ok: true, message: "Tersimpan." };
  });
  revalidatePath("/pengaturan/departemen");
  return r;
}

export async function importAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const kind = str(fd, "kind");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pilih file CSV." };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "File maksimal 2 MB." };
  const text = await file.text();
  const dryRun = str(fd, "mode") !== "commit";
  return runAction(async (actor, tx) => {
    const rep = kind === "employees" ? await importEmployees(tx, actor, text, dryRun) : await importVillas(tx, actor, text, dryRun);
    if (rep.errors.length) {
      // Throwing rolls back the transaction: nothing from this file is saved.
      throw new ValidationError(`File ditolak (${rep.errors.length} kesalahan): ` + rep.errors.slice(0, 15).map((e) => `baris ${e.row}: ${e.message}`).join("; "));
    }
    return { ok: true, message: dryRun ? "Validasi berhasil — tidak ada kesalahan. Jalankan impor untuk menyimpan." : `Impor selesai: ${rep.created} dibuat, ${rep.updated} diperbarui.`, data: rep.credentials ?? null };
  });
}
