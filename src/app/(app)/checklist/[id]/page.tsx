import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getSubmission } from "@/services/checklists";
import { PageHeader, Card, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PhotoGrid } from "@/components/photos";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime } from "@/lib/format";
import { ANSWER_LABEL, PRIORITIES, PRIORITY_LABEL } from "@/lib/labels";
import { reportItemAction } from "../actions";

export default async function SubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ baru?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const res = await load(() => getSubmission(db, actor, id));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { s, villa, by, template, answers, photos } = res.data;
  const failed = answers.filter((a) => a.answer === "no");
  const canReport = can(actor, "maintenance.report");
  return (
    <>
      <PageHeader back={{ href: "/checklist", label: "Checklist" }} title={`${villa.name} — ${template}`}
        subtitle={<>{s.code} · {by} · {fmtDateTime(s.submittedAt)}</>} />
      {sp.baru && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Checklist terkirim.{failed.length > 0 && " Laporkan item bermasalah ke Engineering di bawah ini."}</div>}
      {failed.length > 0 && (
        <Card title={`Item bermasalah (${failed.length})`} className="mb-4 border-red-200">
          <ul className="space-y-4">
            {failed.map((a) => (
              <li key={a.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                <div className="font-medium">{a.label}</div>
                <p className="text-sm text-slate-700">{a.note}</p>
                <PhotoGrid files={photos.filter((p) => p.entityId === a.id)} empty="" />
                {a.maintenanceRequestId ? <Badge tone="blue">Sudah dilaporkan ke Engineering</Badge> : canReport && (
                  <ActionForm action={reportItemAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="answerId" value={a.id} /><input type="hidden" name="submissionId" value={s.id} />
                    <select name="priority" defaultValue="normal" className="input w-auto" aria-label="Prioritas">
                      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                    </select>
                    <SubmitButton className="btn-danger" pendingText="Melaporkan…">Buat permintaan maintenance</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Semua jawaban">
        <ul className="divide-y divide-slate-100">
          {answers.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span><span className="text-xs text-slate-400">{a.section}</span><br />{a.label}{a.note && <span className="block text-xs text-slate-500">{a.note}</span>}</span>
              <Badge tone={a.answer === "yes" ? "green" : a.answer === "no" ? "red" : "gray"}>{ANSWER_LABEL[a.answer]}</Badge>
            </li>
          ))}
        </ul>
        {s.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{s.notes}</p>}
        <p className="mt-3 text-xs text-slate-500"><Link href={`/properti/${villa.id}`} className="link">Buka villa</Link></p>
      </Card>
    </>
  );
}
