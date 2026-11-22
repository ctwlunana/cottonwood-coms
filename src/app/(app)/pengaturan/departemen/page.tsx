import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { listDepartments } from "@/services/employees";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { createDepartmentAction, updateDepartmentAction } from "../actions";

export const metadata = { title: "Departemen" };

export default async function DepartmentsPage() {
  const actor = await requireActor();
  if (!can(actor, "department.manage")) return <Forbidden />;
  const depts = await listDepartments(db);
  return (
    <>
      <PageHeader title="Departemen" back={{ href: "/pengaturan", label: "Pengaturan" }} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card divide-y divide-slate-100 lg:col-span-2">
          {depts.map((d) => (
            <ActionForm key={d.id} action={updateDepartmentAction} className="flex flex-wrap items-center gap-2 p-3">
              <input type="hidden" name="id" value={d.id} />
              <input name="code" defaultValue={d.code} className="input w-24 font-mono uppercase" aria-label="Kode" />
              <input name="name" defaultValue={d.name} className="input min-w-0 flex-1" aria-label="Nama" />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" value="1" defaultChecked={d.isActive} /> Aktif</label>
              <SubmitButton className="btn-secondary">Simpan</SubmitButton>
            </ActionForm>
          ))}
        </div>
        <Card title="Tambah departemen">
          <ActionForm action={createDepartmentAction} resetOnSuccess>
            <div><label className="label">Kode *</label><input name="code" className="input uppercase" required /></div>
            <div><label className="label">Nama *</label><input name="name" className="input" required /></div>
            <SubmitButton>Tambah</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
