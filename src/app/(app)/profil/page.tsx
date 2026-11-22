import { db } from "@/db";
import { getSession, requireActor } from "@/lib/session";
import { listMySessions } from "@/services/auth";
import { getMyPreferences } from "@/services/notifications";
import { emailAdapter, whatsappAdapter } from "@/lib/notify/channels";
import { PageHeader, Card, Badge } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { changePasswordAction, revokeSessionAction, preferencesAction } from "./actions";

export const metadata = { title: "Profil" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ wajib?: string }> }) {
  const actor = await requireActor({ allowPasswordChange: true });
  const s = (await getSession())!;
  const sp = await searchParams;
  const [sessions, prefs] = await Promise.all([listMySessions(db, actor), getMyPreferences(db, actor)]);
  return (
    <>
      <PageHeader title="Profil saya" subtitle={`${actor.fullName} · ${actor.username}`} />
      {(s.mustChangePassword || sp.wajib) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Anda wajib mengganti password sementara sebelum menggunakan COMS.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ganti password">
          <ActionForm action={changePasswordAction}>
            <div><label className="label">Password saat ini</label><input name="current" type="password" className="input" autoComplete="current-password" required /></div>
            <div><label className="label">Password baru</label><input name="next" type="password" minLength={10} className="input" autoComplete="new-password" required />
              <p className="mt-1 text-xs text-slate-500">Minimal 10 karakter, kombinasi huruf dan angka. Sesi lain akan dikeluarkan.</p></div>
            <div><label className="label">Ulangi password baru</label><input name="next2" type="password" className="input" autoComplete="new-password" required /></div>
            <SubmitButton>Simpan password</SubmitButton>
          </ActionForm>
        </Card>
        {!s.mustChangePassword && (
          <div className="space-y-4">
            <Card title="Sesi login aktif">
              <ul className="space-y-3">
                {sessions.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0"><div className="truncate">{x.userAgent ?? "Perangkat tidak dikenal"}</div>
                      <div className="text-xs text-slate-500">IP {x.ip ?? "—"} · aktif {fmtDateTime(x.lastSeenAt)}</div></div>
                    {x.id === s.sessionId ? <Badge tone="green">Sesi ini</Badge>
                      : <ConfirmButton action={revokeSessionAction} hidden={{ sessionId: x.id }} label="Keluarkan" className="btn-ghost text-xs" confirm="Keluarkan perangkat ini?" />}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Preferensi notifikasi">
              <ActionForm action={preferencesAction}>
                <p className="text-sm text-slate-600">Notifikasi di aplikasi selalu aktif. Notifikasi kritis selalu dikirim ke semua kanal yang tersedia.</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email" value="1" defaultChecked={prefs.email} /> Email {!emailAdapter.configured() && <Badge>belum dikonfigurasi</Badge>}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsapp" value="1" defaultChecked={prefs.whatsapp} /> WhatsApp {!whatsappAdapter.configured() && <Badge>belum dikonfigurasi</Badge>}</label>
                <SubmitButton className="btn-secondary">Simpan preferensi</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
