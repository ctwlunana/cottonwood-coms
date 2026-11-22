import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "../actions";

export const metadata = { title: "Masuk" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h2 className="mb-4 text-base font-semibold">Masuk ke akun Anda</h2>
      {sp.reset && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password berhasil diganti. Silakan masuk.</p>}
      <ActionForm action={loginAction}>
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="none" required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Memeriksa…">Masuk</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/lupa-password" className="link">Lupa password?</Link></p>
      <p className="mt-4 text-center text-xs text-slate-400">Setiap karyawan wajib menggunakan akun pribadi. Jangan berbagi akun.</p>
    </>
  );
}
