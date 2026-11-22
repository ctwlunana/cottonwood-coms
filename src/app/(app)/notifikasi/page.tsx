import Link from "next/link";
import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { listMyNotifications } from "@/services/notifications";
import { PageHeader, Empty, Badge, Pagination } from "@/components/ui";
import { ConfirmButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { markAllReadAction } from "./actions";

export const metadata = { title: "Notifikasi" };
const PRIO = { critical: ["red", "Kritis"], high: ["yellow", "Tinggi"], normal: ["gray", "Normal"], low: ["gray", "Rendah"] } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string; page?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const res = await listMyNotifications(db, actor, { unreadOnly: sp.unread === "1", page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Notifikasi" actions={<>
        <Link href={sp.unread === "1" ? "/notifikasi" : "/notifikasi?unread=1"} className="btn-secondary">{sp.unread === "1" ? "Tampilkan semua" : "Belum dibaca saja"}</Link>
        <ConfirmButton action={markAllReadAction} label="Tandai semua dibaca" confirm="Tandai semua notifikasi sebagai dibaca?" />
      </>} />
      {res.rows.length === 0 ? <Empty title="Tidak ada notifikasi" /> : (
        <ul className="card divide-y divide-slate-100">
          {res.rows.map((n) => (
            <li key={n.id}>
              <Link href={`/notifikasi/${n.id}`} className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.readAt ? "" : "bg-brand-50/60"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{n.title}</span>
                    {n.priority !== "normal" && <Badge tone={PRIO[n.priority][0]}>{PRIO[n.priority][1]}</Badge>}</div>
                  {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={res.page} total={res.total} pageSize={res.pageSize} params={{ unread: sp.unread }} />
    </>
  );
}
