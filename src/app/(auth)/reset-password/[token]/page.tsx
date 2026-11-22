import Link from "next/link";
import { db } from "@/db";
import { checkResetToken } from "@/services/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { resetAction } from "../../actions";

export const metadata = { title: "Reset password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await checkResetToken(db, token);
  if (!t) {
    return (
      <>
        <h2 className="mb-2 text-base font-semibold">Link tidak valid</h2>
        <p className="text-sm text-slate-500">Link reset sudah digunakan atau kedaluwarsa. Minta link baru ke administrator.</p>
        <p className="mt-4 text-center text-sm"><Link href="/login" className="link">Kembali</Link></p>
      </>
    );
  }
  return (
    <>
      <h2 className="mb-1 text-base font-semibold">Buat password baru</h2>
      <p className="mb-4 text-sm text-slate-500">{t.fullName} ({t.username})</p>
      <ActionForm action={resetAction}>
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label" htmlFor="password">Password baru</label>
          <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required />
          <p className="mt-1 text-xs text-slate-500">Minimal 10 karakter, kombinasi huruf dan angka.</p>
        </div>
        <div>
          <label className="label" htmlFor="password2">Ulangi password</label>
          <input id="password2" name="password2" type="password" className="input" autoComplete="new-password" required />
        </div>
        <SubmitButton className="btn-primary w-full">Simpan password</SubmitButton>
      </ActionForm>
    </>
  );
}
