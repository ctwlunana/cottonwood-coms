import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getEmployee, listDepartments } from "@/services/employees";
import { listRoles, financialRoleIds } from "@/services/rbac";
import { listAudit } from "@/services/audit";
import { PageHeader, Card, DL, Badge, DemoBadge, Empty } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/forms";
import { EmployeeFields, RoleCheckboxes, ResetLinkForm } from "@/components/employee-forms";
import { AuditList } from "@/components/audit-list";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime } from "@/lib/format";
import { updateEmployeeAction, setRolesAction, setActiveAction, issueResetAction } from "../actions";

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getEmployee(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { user: u, roles: userRoles, propertyAssignments, locationAssignments, pendingResetRequests } = res.data;
  const canManage = can(actor, "employee.manage"), canRbac = can(actor, "rbac.manage"), canReset = can(actor, "employee.reset_password");
  const self = id === actor.id;
  const [depts, roles, fin, history] = await Promise.all([
    listDepartments(db), canRbac ? listRoles(db, actor) : Promise.resolve([]), financialRoleIds(db),
    can(actor, "audit.view") ? listAudit(db, actor, { entityType: "user", entityId: id }) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/karyawan", label: "Karyawan" }} title={u.fullName}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{u.employeeCode}</span> · {u.username} {u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>} <DemoBadge show={u.isDemo} />{u.mustChangePassword && <Badge tone="yellow">Wajib ganti password</Badge>}</span>}
        actions={canManage && !self && <ConfirmButton action={setActiveAction} hidden={{ id, active: u.isActive ? "0" : "1" }}
          label={u.isActive ? "Nonaktifkan akun" : "Aktifkan akun"} className={u.isActive ? "btn-danger" : "btn-primary"}
          confirm={u.isActive ? "Nonaktifkan akun ini? Semua sesi login dihentikan dan penugasan villa/lokasi diakhiri." : "Aktifkan kembali akun ini?"} />} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Data karyawan">
            {canManage ? (
              <ActionForm action={updateEmployeeAction}>
                <EmployeeFields e={u} departments={depts} />
                <div className="flex justify-end"><SubmitButton>Simpan</SubmitButton></div>
              </ActionForm>
            ) : <DL items={[["Jabatan", u.jobTitle], ["Departemen", depts.find((d) => d.id === u.departmentId)?.name], ["HP", u.phone], ["Email", u.email]]} />}
          </Card>
          <Card title="Peran & hak akses">
            {canRbac && !self ? (
              <ActionForm action={setRolesAction}>
                <input type="hidden" name="id" value={id} />
                <RoleCheckboxes roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description, financial: fin.has(r.id) }))} selected={userRoles.map((r) => r.id)} />
                <p className="text-xs text-slate-500">Peran berlabel <b>HANYA GM</b> (keuangan/approval/backup) hanya dapat diberikan/dicabut oleh GM. Satu karyawan boleh memiliki lebih dari satu peran.</p>
                <div className="flex justify-end"><SubmitButton>Simpan peran</SubmitButton></div>
              </ActionForm>
            ) : (
              <div className="flex flex-wrap gap-2">{userRoles.length ? userRoles.map((r) => <Badge key={r.id} tone="blue">{r.name}</Badge>) : <span className="text-sm text-red-600">Tanpa peran</span>}
                {self && canRbac && <p className="w-full text-xs text-slate-500">Anda tidak dapat mengubah peran Anda sendiri.</p>}</div>
            )}
          </Card>
          {history && <Card title="Riwayat akun"><AuditList rows={history.rows.map((r) => ({ id: r.log.id, action: r.log.action, at: r.log.at, user: r.user, before: r.log.before, after: r.log.after }))} /></Card>}
        </div>
        <div className="space-y-4">
          <Card title="Akun">
            <DL items={[["Login terakhir", fmtDateTime(u.lastLoginAt)], ["Password diganti", fmtDateTime(u.passwordChangedAt)], ["Dibuat", fmtDateTime(u.createdAt)]]} />
            {canReset && !self && u.isActive && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                {pendingResetRequests.length > 0 && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Karyawan meminta reset password pada {fmtDateTime(pendingResetRequests[0].createdAt)}.</p>}
                <ResetLinkForm action={issueResetAction} id={id} />
              </div>
            )}
          </Card>
          <Card title="Penugasan villa & lokasi">
            {propertyAssignments.length + locationAssignments.length === 0 ? <Empty title="Tidak ada penugasan" /> : (
              <ul className="space-y-1.5 text-sm">
                {propertyAssignments.map((a) => <li key={a.id}><Link className="link" href={`/properti/${a.propertyId}`}>{a.name}</Link> <span className="text-xs text-slate-500">({a.kind === "villa_keeper" ? "Keeper" : "Inspektur"})</span></li>)}
                {locationAssignments.map((a) => <li key={a.id}><Link className="link" href={`/lokasi/${a.locationId}`}>{a.name}</Link> <span className="text-xs text-slate-500">({a.kind === "location_pic" ? "PIC Lokasi" : "TL HK"})</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
