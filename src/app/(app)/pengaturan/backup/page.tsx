import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { backupHistory, listScheduledBackups } from "@/services/backup";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { Forbidden } from "@/components/forbidden";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Backup data" };

const KB = (n: number | null | undefined) => (n == null ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default async function BackupPage() {
  const actor = await requireActor();
  const res = await load(async () => {
    const history = await backupHistory(db, actor);
    let scheduled: { key: string; size: number; uploaded: Date }[] = [];
    let scheduledError: string | null = null;
    try { scheduled = await listScheduledBackups(actor); } catch (e) { scheduledError = (e as Error).message; }
    return { history, scheduled, scheduledError };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { history, scheduled, scheduledError } = res.data;
  return (
    <>
      <PageHeader title="Backup data" back={{ href: "/pengaturan", label: "Pengaturan" }}
        subtitle="Unduh salinan lengkap data COMS ke perangkat Anda (di luar server). Hanya untuk Manager ke atas; setiap unduhan tercatat di audit trail." />
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        File backup berisi <b>seluruh data</b> termasuk data pribadi tamu, karyawan, dan keuangan. Simpan di tempat aman (mis. Google Drive / OneDrive perusahaan dengan akses terbatas). Jangan dikirim lewat chat.
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1. Backup database">
          <p className="mb-3 text-sm text-slate-600">Semua tabel dalam satu snapshot yang konsisten (format <code>.json.gz</code>). Dapat dipulihkan dengan <code>npm run backup:restore</code>.</p>
          <form method="post" action="/api/backup/database"><button className="btn-primary w-full sm:w-auto" type="submit">⬇ Backup File — Database</button></form>
        </Card>
        <Card title="2. Backup foto & dokumen">
          <p className="mb-3 text-sm text-slate-600">Semua foto dan dokumen yang diunggah (format <code>.tar</code>, dengan daftar isi MANIFEST.json). Ukuran bisa besar.</p>
          <form method="post" action="/api/backup/files"><button className="btn-secondary w-full sm:w-auto" type="submit">⬇ Backup File — Foto & Dokumen</button></form>
        </Card>
        <Card title="Backup otomatis harian (02:00 WIB)">
          <p className="mb-3 text-xs text-slate-500">Disimpan di Cloudflare R2 (terpisah dari server database), disimpan 30 hari.</p>
          {scheduledError ? <p className="text-sm text-slate-500">Penyimpanan backup otomatis belum tersedia di lingkungan ini.</p>
            : scheduled.length === 0 ? <Empty title="Belum ada backup otomatis" /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {scheduled.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-mono text-xs">{b.key.replace("backups/", "")}</span><span className="block text-xs text-slate-500">{fmtDateTime(b.uploaded)} · {KB(b.size)}</span></span>
                    <form method="post" action="/api/backup/scheduled"><input type="hidden" name="key" value={b.key} /><button className="btn-ghost text-xs" type="submit">Unduh</button></form>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Riwayat backup">
          {history.length === 0 ? <Empty title="Belum pernah backup" hint="Lakukan backup pertama sekarang." /> : (
            <ul className="space-y-2 text-sm">
              {history.map(({ log, by }) => (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{log.kind === "database" ? "Database" : "Foto & dokumen"} · {log.trigger === "scheduled" ? "otomatis" : `diunduh oleh ${by ?? "—"}`}
                    <span className="block text-xs text-slate-500">{fmtDateTime(log.createdAt)}{log.rows != null && ` · ${log.rows} baris`}{log.files != null && ` · ${log.files} file`}{log.sizeBytes != null && ` · ${KB(log.sizeBytes)}`}</span></span>
                  {log.status === "completed" ? <Badge tone="green">Berhasil</Badge> : <Badge tone="red" >{log.status === "failed" ? "Gagal" : "Sebagian"}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
