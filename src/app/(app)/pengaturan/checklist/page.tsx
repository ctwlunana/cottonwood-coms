import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { listTemplates } from "@/services/checklists";
import { PageHeader, Card, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { createTemplateAction } from "../../checklist/actions";

export const metadata = { title: "Template checklist" };

export default async function Templates() {
  const actor = await requireActor();
  if (!can(actor, "checklist.template_manage")) return <Forbidden />;
  const list = await listTemplates(db, actor);
  return (
    <>
      <PageHeader title="Template checklist" back={{ href: "/pengaturan", label: "Pengaturan" }} subtitle="Item yang diubah tidak mengubah checklist lama (jawaban menyimpan salinan label)." />
      <div className="grid gap-4 lg:grid-cols-3">
        <ul className="card divide-y divide-slate-100 lg:col-span-2">
          {list.map((t) => (
            <li key={t.id}><Link href={`/pengaturan/checklist/${t.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <span><span className="font-medium">{t.name}</span><span className="block text-xs text-slate-500">{t.items} item aktif</span></span>
              {!t.isActive && <Badge>Nonaktif</Badge>}</Link></li>
          ))}
        </ul>
        <Card title="Template baru">
          <ActionForm action={createTemplateAction}>
            <div><label className="label">Nama *</label><input name="name" className="input" required /></div>
            <div><label className="label">Deskripsi</label><input name="description" className="input" /></div>
            <SubmitButton>Buat</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
