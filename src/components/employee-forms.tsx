"use client";
import Link from "next/link";
import { ActionForm, SubmitButton } from "./forms";
import type { ActionState } from "@/lib/action";

type Dept = { id: string; name: string };
type Role = { id: string; name: string; description: string | null; financial: boolean };
type E = { id?: string; employeeCode?: string; username?: string; fullName?: string; email?: string | null; phone?: string | null; jobTitle?: string | null; departmentId?: string | null };
type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function EmployeeFields({ e = {}, departments }: { e?: E; departments: Dept[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {e.id && <input type="hidden" name="id" value={e.id} />}
      <div><label className="label">Nama lengkap *</label><input name="fullName" className="input" defaultValue={e.fullName} required /></div>
      <div><label className="label">Kode karyawan *</label><input name="employeeCode" className="input" defaultValue={e.employeeCode} required /></div>
      <div><label className="label">Username *</label><input name="username" className="input" autoCapitalize="none" defaultValue={e.username} required /></div>
      <div><label className="label">Departemen *</label>
        <select name="departmentId" className="input" defaultValue={e.departmentId ?? ""} required>
          <option value="" disabled>— Pilih —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></div>
      <div><label className="label">Jabatan</label><input name="jobTitle" className="input" defaultValue={e.jobTitle ?? ""} /></div>
      <div><label className="label">No. HP</label><input name="phone" type="tel" className="input" defaultValue={e.phone ?? ""} /></div>
      <div className="sm:col-span-2"><label className="label">Email</label><input name="email" type="email" className="input" defaultValue={e.email ?? ""} /></div>
    </div>
  );
}

export function RoleCheckboxes({ roles, selected = [] }: { roles: Role[]; selected?: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50">
          <input type="checkbox" name="roleIds" value={r.id} defaultChecked={selected.includes(r.id)} className="mt-1" />
          <span><span className="font-medium">{r.name}</span>{r.financial && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">HANYA GM</span>}
            {r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</span>
        </label>
      ))}
    </div>
  );
}

export function NewEmployeeForm({ action, departments, roles }: { action: Act; departments: Dept[]; roles: Role[] }) {
  return (
    <ActionForm action={action} className="space-y-6" render={(s) => {
      const d = s?.ok ? (s.data as { id: string; username: string; password: string }) : null;
      return d ? (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold">Akun {d.username} dibuat. Password sementara (tampil sekali):</p>
          <p className="my-2 select-all font-mono text-lg">{d.password}</p>
          <p className="text-amber-900">Serahkan langsung ke karyawan. Password wajib diganti saat login pertama.</p>
          <Link href={`/karyawan/${d.id}`} className="btn-secondary mt-3">Buka profil karyawan</Link>
        </div>
      ) : null;
    }}>
      <div className="card p-4 sm:p-6"><EmployeeFields departments={departments} /></div>
      <div className="card p-4 sm:p-6"><h2 className="mb-3 text-sm font-semibold">Peran</h2><RoleCheckboxes roles={roles} /></div>
      <div className="flex justify-end"><SubmitButton>Buat akun</SubmitButton></div>
    </ActionForm>
  );
}

export function ResetLinkForm({ action, id }: { action: Act; id: string }) {
  return (
    <ActionForm action={action} confirm="Terbitkan link reset password? Link lama akan dibatalkan." render={(s) => {
      const url = s?.ok ? (s.data as { url: string }).url : null;
      return url ? <p className="select-all break-all rounded-lg bg-slate-100 p-2 font-mono text-xs">{url}</p> : null;
    }}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-secondary w-full" pendingText="Menerbitkan…">Terbitkan link reset password</SubmitButton>
    </ActionForm>
  );
}
