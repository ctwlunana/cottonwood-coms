import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { PageHeader, Card } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { ImportForm } from "@/components/import-form";
import { importAction } from "../actions";

export const metadata = { title: "Impor CSV" };

export default async function ImportPage() {
  const actor = await requireActor();
  if (!can(actor, "import.run")) return <Forbidden />;
  return (
    <>
      <PageHeader title="Impor CSV" back={{ href: "/pengaturan", label: "Pengaturan" }}
        subtitle="Seluruh file divalidasi dahulu. Jika ada satu baris salah, tidak ada data yang disimpan. Semua impor tercatat di audit trail." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Villa" actions={<a className="link text-sm" href="/api/templates/villas">Unduh template</a>}>
          <p className="mb-3 text-xs text-slate-500">Kolom wajib: name, location_code, bedrooms, bathrooms. Lokasi baru dibuat otomatis. Villa dengan <code>code</code> yang sudah ada akan diperbarui. <code>keeper_employee_code</code> menugaskan Villa Keeper.</p>
          {can(actor, "property.manage") ? <ImportForm action={importAction} kind="villas" /> : <p className="text-sm text-slate-500">Butuh hak akses kelola villa.</p>}
        </Card>
        <Card title="Karyawan" actions={<a className="link text-sm" href="/api/templates/employees">Unduh template</a>}>
          <p className="mb-3 text-xs text-slate-500">Kolom wajib: employee_code, username, full_name, department_code. Kolom <code>roles</code> berisi slug peran dipisah titik koma (mis. <code>villa_keeper;location_pic</code>). Peran ber-otoritas keuangan hanya dapat diimpor oleh GM.</p>
          {can(actor, "employee.manage") ? <ImportForm action={importAction} kind="employees" /> : <p className="text-sm text-slate-500">Butuh hak akses kelola karyawan.</p>}
        </Card>
        <Card title="Template untuk tahap berikutnya">
          <ul className="space-y-1 text-sm">
            <li><a className="link" href="/api/templates/inventory">Template inventory</a> — impor aktif di Tahap 4</li>
            <li><a className="link" href="/api/templates/suppliers">Template supplier</a> — impor aktif di Tahap 4</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
