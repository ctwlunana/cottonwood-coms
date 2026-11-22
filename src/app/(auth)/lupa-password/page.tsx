import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { forgotAction } from "../actions";

export const metadata = { title: "Lupa password" };

export default function ForgotPage() {
  return (
    <>
      <h2 className="mb-2 text-base font-semibold">Lupa password</h2>
      <p className="mb-4 text-sm text-slate-500">Masukkan username Anda. Administrator akan menerima permintaan dan mengirimkan link reset (berlaku 2 jam).</p>
      <ActionForm action={forgotAction} resetOnSuccess>
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" name="username" className="input" autoCapitalize="none" required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Mengirim…">Kirim permintaan</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/login" className="link">Kembali ke halaman masuk</Link></p>
    </>
  );
}
