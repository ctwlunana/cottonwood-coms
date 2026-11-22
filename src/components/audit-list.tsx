import { fmtDateTime } from "@/lib/format";

export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Login", "auth.logout": "Logout", "auth.login_failed": "Login gagal",
  "auth.password_changed": "Ganti password", "auth.password_reset": "Reset password", "auth.password_reset_requested": "Minta reset password",
  "auth.reset_link_issued": "Link reset diterbitkan", "auth.session_revoked": "Sesi dicabut",
  "employee.created": "Karyawan dibuat", "employee.updated": "Data karyawan diubah", "employee.activated": "Akun diaktifkan", "employee.deactivated": "Akun dinonaktifkan",
  "rbac.permission_changed": "Hak akses peran diubah", "rbac.user_roles_changed": "Peran karyawan diubah", "rbac.role_created": "Peran dibuat",
  "property.created": "Villa dibuat", "property.updated": "Data villa diubah", "property.status_changed": "Status villa diubah",
  "property.archived": "Villa diarsipkan", "property.restored": "Villa dipulihkan",
  "property.user_assigned": "Penugasan ditambahkan", "property.user_unassigned": "Penugasan diakhiri",
  "location.created": "Lokasi dibuat", "location.updated": "Lokasi diubah", "location.user_assigned": "PIC ditugaskan", "location.user_unassigned": "PIC diakhiri",
  "attachment.added": "File diunggah", "attachment.removed": "File disembunyikan",
  "setting.update": "Pengaturan diubah", "department.created": "Departemen dibuat", "department.updated": "Departemen diubah",
  "import.villas": "Impor villa", "import.employees": "Impor karyawan",
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ChangeTable({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !["createdAt", "updatedAt", "id"].includes(k));
  if (!keys.length) return null;
  return (
    <table className="mt-1 w-full text-xs">
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="align-top">
            <td className="w-1/4 py-0.5 pr-2 text-slate-500">{k}</td>
            <td className="w-3/8 break-all py-0.5 pr-2 text-red-700 line-through decoration-red-300">{k in b ? fmtVal(b[k]) : ""}</td>
            <td className="w-3/8 break-all py-0.5 text-emerald-700">{k in a ? fmtVal(a[k]) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditList({ rows }: { rows: { id: number; action: string; at: Date; user: string | null; before: unknown; after: unknown }[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Belum ada riwayat.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-slate-200 pl-3">
          <div className="text-sm"><span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span> <span className="text-slate-500">oleh {r.user ?? "Sistem"}</span></div>
          <div className="text-xs text-slate-400">{fmtDateTime(r.at)}</div>
          <ChangeTable before={r.before} after={r.after} />
        </li>
      ))}
    </ol>
  );
}
