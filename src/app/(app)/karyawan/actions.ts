"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { createEmployee, updateEmployee, setEmployeeActive } from "@/services/employees";
import { setUserRoles } from "@/services/rbac";
import { issueResetToken } from "@/services/auth";
import { fmtDateTime } from "@/lib/format";

const fields = (fd: FormData) => ({
  employeeCode: str(fd, "employeeCode"), username: str(fd, "username"), fullName: str(fd, "fullName"),
  email: str(fd, "email"), phone: str(fd, "phone"), jobTitle: str(fd, "jobTitle"), departmentId: str(fd, "departmentId"),
});

export async function createEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async (actor, tx) => {
    const r = await createEmployee(tx, actor, fields(fd), fd.getAll("roleIds").map(String));
    return { ok: true, message: "Karyawan dibuat.", data: { id: r.user.id, username: r.user.username, password: r.temporaryPassword } };
  });
}

export async function updateEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => { await updateEmployee(tx, actor, id, fields(fd)); return { ok: true, message: "Data karyawan disimpan." }; });
  revalidatePath(`/karyawan/${id}`);
  return r;
}

export async function setRolesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => { await setUserRoles(tx, actor, id, fd.getAll("roleIds").map(String)); return { ok: true, message: "Peran disimpan." }; });
  revalidatePath(`/karyawan/${id}`);
  return r;
}

export async function setActiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => { await setEmployeeActive(tx, actor, id, str(fd, "active") === "1"); return { ok: true }; });
  revalidatePath(`/karyawan/${id}`);
  return r;
}

export async function issueResetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => {
    const t = await issueResetToken(tx, actor, id);
    const url = `${process.env.APP_URL ?? ""}/reset-password/${t.token}`;
    return { ok: true, message: `Link reset (berlaku sampai ${fmtDateTime(t.expiresAt)}). Kirimkan langsung ke karyawan; link hanya ditampilkan sekali.`, data: { url } };
  });
  revalidatePath(`/karyawan/${id}`);
  return r;
}
