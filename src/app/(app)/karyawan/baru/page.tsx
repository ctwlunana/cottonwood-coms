import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { requirePermission, can } from "@/lib/authz";
import { load } from "@/lib/page";
import { listDepartments } from "@/services/employees";
import { listRoles, financialRoleIds } from "@/services/rbac";
import { PageHeader } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { NewEmployeeForm } from "@/components/employee-forms";
import { createEmployeeAction } from "../actions";

export const metadata = { title: "Karyawan baru" };

export default async function NewEmployee() {
  const actor = await requireActor();
  const res = await load(async () => {
    requirePermission(actor, "employee.manage");
    return Promise.all([listDepartments(db), listRoles(db, actor), financialRoleIds(db)]);
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [depts, roles, fin] = res.data;
  const roleOpts = can(actor, "rbac.manage") ? roles.map((r) => ({ id: r.id, name: r.name, description: r.description, financial: fin.has(r.id) })) : [];
  return (
    <>
      <PageHeader title="Tambah karyawan" back={{ href: "/karyawan", label: "Karyawan" }} subtitle="Setiap karyawan mendapat akun pribadi. Akun bersama departemen tidak diperbolehkan." />
      <NewEmployeeForm action={createEmployeeAction} departments={depts.filter((d) => d.isActive)} roles={roleOpts} />
    </>
  );
}
