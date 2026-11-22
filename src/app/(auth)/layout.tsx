export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-lg font-bold text-white">C</div>
          <h1 className="text-lg font-semibold text-slate-900">Cottonwood Operations</h1>
          <p className="text-sm text-slate-500">Sistem Manajemen Operasional</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
