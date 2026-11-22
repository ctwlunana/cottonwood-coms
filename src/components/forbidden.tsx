import Link from "next/link";
export function Forbidden({ message = "Anda tidak memiliki hak akses untuk halaman ini." }: { message?: string }) {
  return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center">
      <p className="text-base font-semibold">Akses ditolak</p>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
      <Link href="/dashboard" className="btn-secondary mt-4">Kembali ke dashboard</Link>
    </div>
  );
}
