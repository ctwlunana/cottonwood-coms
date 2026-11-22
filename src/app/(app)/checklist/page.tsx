import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { listSubmissions, todayChecklistStatus } from "@/services/checklists";
import { PageHeader, Empty, Badge, Pagination, Card } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime, fmtDate } from "@/lib/format";

export const metadata = { title: "Checklist villa" };

export default async function ChecklistPage({ searchParams }: { searchParams: Promise<{ failed?: string; date?: string; page?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await load(async () => {
    const today = can(actor, "checklist.submit") ? await todayChecklistStatus(db, actor) : null;
    const list = can(actor, "checklist.view") ? await listSubmissions(db, actor, { failedOnly: sp.failed === "1", date: sp.date, page: Number(sp.page) || 1 }) : null;
    return { today, list };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { today, list } = res.data;
  return (
    <>
      <PageHeader title="Checklist villa" actions={can(actor, "checklist.submit") && <Link href="/checklist/baru" className="btn-primary">+ Isi checklist</Link>} />
      {today && (
        <Card title="Hari ini" className="mb-4">
          {today.length === 0 ? <p className="text-sm text-slate-500">Tidak ada villa yang ditugaskan.</p> : (
            <ul className="divide-y divide-slate-100">
              {today.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0"><div className="truncate font-medium">{v.name}</div><div className="text-xs text-slate-500">{v.location}</div></div>
                  {v.doneAt ? <Badge tone={v.fails ? "red" : "green"}>{v.fails ? `${v.fails} masalah` : "Selesai"}</Badge>
                    : <Link href={`/checklist/baru?villa=${v.id}`} className="btn-primary px-3 py-1.5 text-xs">Isi sekarang</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {list && (
        <>
          <form className="mb-3 flex flex-wrap gap-2" method="get">
            <input type="date" name="date" defaultValue={sp.date} className="input w-auto" aria-label="Tanggal" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="failed" value="1" defaultChecked={sp.failed === "1"} /> Hanya yang bermasalah</label>
            <button className="btn-secondary" type="submit">Filter</button>
          </form>
          {list.rows.length === 0 ? <Empty title="Belum ada checklist" /> : (
            <ul className="card divide-y divide-slate-100">
              {list.rows.map(({ s, villa, by }) => (
                <li key={s.id}>
                  <Link href={`/checklist/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0"><div className="font-medium">{villa}</div>
                      <div className="text-xs text-slate-500">{fmtDate(s.checkDate)} · {by} · {fmtDateTime(s.submittedAt)}</div></div>
                    {s.failCount ? <Badge tone="red">{s.failCount} bermasalah</Badge> : <Badge tone="green">Semua baik</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={list.page} total={list.total} pageSize={list.pageSize} params={{ failed: sp.failed, date: sp.date }} />
        </>
      )}
    </>
  );
}
