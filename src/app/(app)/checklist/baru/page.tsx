import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { requirePermission } from "@/lib/authz";
import { listTemplates, getTemplate, todayChecklistStatus } from "@/services/checklists";
import { listProperties } from "@/services/properties";
import { PageHeader, Empty } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { ChecklistForm } from "@/components/checklist-form";
import { submitChecklistAction } from "../actions";
import Link from "next/link";

export const metadata = { title: "Isi checklist" };

export default async function NewChecklist({ searchParams }: { searchParams: Promise<{ villa?: string; template?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(async () => {
    requirePermission(actor, "checklist.submit");
    const templates = await listTemplates(db, actor, { activeOnly: true });
    const tpl = templates.find((t) => t.id === sp.template) ?? templates[0];
    const [detail, villas, today] = await Promise.all([
      tpl ? getTemplate(db, actor, tpl.id) : null, listProperties(db, actor), todayChecklistStatus(db, actor),
    ]);
    return { templates, tpl, detail, villas: villas.rows.map((v) => ({ id: v.id, name: v.name, done: !!today?.find((t) => t.id === v.id)?.doneAt })) };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { templates, tpl, detail, villas } = res.data;
  if (!tpl || !detail) return <Empty title="Belum ada template checklist aktif" hint="Hubungi Supervisor Villa." />;
  return (
    <>
      <PageHeader title="Checklist harian villa" back={{ href: "/checklist", label: "Checklist" }}
        subtitle={templates.length > 1 ? <span className="flex flex-wrap gap-2">{templates.map((t) => <Link key={t.id} className={t.id === tpl.id ? "font-semibold" : "link"} href={`?template=${t.id}${sp.villa ? `&villa=${sp.villa}` : ""}`}>{t.name}</Link>)}</span> : tpl.name} />
      {villas.length === 0 ? <Empty title="Belum ada villa yang ditugaskan kepada Anda" /> : (
        <ChecklistForm action={submitChecklistAction} villas={villas} templateId={tpl.id} defaultVilla={sp.villa}
          items={detail.items.filter((i) => i.isActive).map((i) => ({ id: i.id, label: i.label, section: i.section, photoRequiredOnFail: i.photoRequiredOnFail }))} />
      )}
    </>
  );
}
