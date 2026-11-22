import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getTemplate } from "@/services/checklists";
import { PageHeader, Card, Badge } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/labels";
import { addItemAction, toggleItemAction, toggleTemplateAction } from "../../../checklist/actions";

export default async function TemplateEdit({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "checklist.template_manage")) return <Forbidden />;
  const { id } = await params;
  const res = await load(() => getTemplate(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { template: t, items } = res.data;
  return (
    <>
      <PageHeader title={t.name} back={{ href: "/pengaturan/checklist", label: "Template checklist" }}
        actions={<ConfirmButton action={toggleTemplateAction} hidden={{ templateId: id, active: t.isActive ? "0" : "1" }} label={t.isActive ? "Nonaktifkan template" : "Aktifkan template"} confirm="Ubah status template?" />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <ul className="card divide-y divide-slate-100 lg:col-span-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className={i.isActive ? "" : "text-slate-400 line-through"}><span className="text-xs text-slate-400">{i.sortOrder} · {i.section}</span><br />{i.label}
                {i.category && <span className="ml-1 text-xs text-slate-500">({CATEGORY_LABEL[i.category as keyof typeof CATEGORY_LABEL] ?? i.category})</span>}
                {i.photoRequiredOnFail && <Badge tone="blue">foto wajib jika bermasalah</Badge>}</span>
              <ConfirmButton action={toggleItemAction} hidden={{ itemId: i.id, templateId: id, active: i.isActive ? "0" : "1" }} label={i.isActive ? "Nonaktifkan" : "Aktifkan"} className="btn-ghost text-xs" confirm="Ubah status item?" />
            </li>
          ))}
        </ul>
        <Card title="Tambah item">
          <ActionForm action={addItemAction} resetOnSuccess>
            <input type="hidden" name="templateId" value={id} />
            <div><label className="label">Pertanyaan *</label><input name="label" className="input" required /></div>
            <div><label className="label">Bagian</label><input name="section" className="input" placeholder="mis. Area luar" /></div>
            <div><label className="label">Kategori maintenance jika bermasalah</label>
              <select name="category" className="input" defaultValue="other">{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
            <div><label className="label">Urutan</label><input name="sortOrder" type="number" min={0} className="input" defaultValue={(items.length + 1) * 10} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="photo" value="1" defaultChecked /> Foto wajib jika bermasalah</label>
            <SubmitButton>Tambah</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
