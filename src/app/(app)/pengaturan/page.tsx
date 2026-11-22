import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";

export const metadata = { title: "Pengaturan" };

export default async function SettingsHub() {
  const actor = await requireActor();
  const items = [
    { href: "/pengaturan/peran", label: "Peran & Hak Akses", desc: "Matriks hak akses per peran, dengan cakupan data.", ok: can(actor, "rbac.manage") },
    { href: "/pengaturan/departemen", label: "Departemen", desc: "Daftar departemen organisasi.", ok: can(actor, "department.manage") },
    { href: "/pengaturan/sistem", label: "Pengaturan sistem", desc: "Ambang approval, jam tenang notifikasi, sesi.", ok: can(actor, "settings.manage") },
    { href: "/pengaturan/impor", label: "Impor CSV", desc: "Impor villa dan karyawan dari template CSV.", ok: can(actor, "import.run") },
  ].filter((i) => i.ok);
  if (!items.length) return <Forbidden />;
  return (
    <>
      <PageHeader title="Pengaturan" />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="card block p-4 hover:border-brand-600">
            <div className="font-semibold">{i.label}</div><div className="mt-1 text-sm text-slate-500">{i.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
