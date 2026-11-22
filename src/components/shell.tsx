"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type Item = { href: string; label: string; icon: string; group: string };

export function Shell({ items, groups, user, unread, logout, children }: {
  items: Item[]; groups: Record<string, string>; user: { name: string; roles: string }; unread: number;
  logout: () => Promise<void>; children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => setCount(unread), [unread]);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (r.ok) setCount((await r.json()).count);
      } catch { /* offline: keep last value */ }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const nav = (
    <nav className="flex flex-col gap-4 p-3">
      {Object.entries(groups).map(([g, label]) => {
        const list = items.filter((i) => i.group === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-100/70">{label}</div>
            {list.map((i) => {
              const active = path === i.href || path.startsWith(i.href + "/");
              return (
                <Link key={i.href} href={i.href}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-white/15 font-medium text-white" : "text-brand-50/90 hover:bg-white/10"}`}>
                  <span className="w-4 text-center opacity-80" aria-hidden>{i.icon}</span>{i.label}
                  {i.href === "/notifikasi" && count > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs text-white">{count}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-60 shrink-0 bg-brand-800 lg:block">
        <div className="px-5 py-4 text-base font-semibold text-white">COMS</div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-brand-800">
            <div className="flex items-center justify-between px-5 py-4 text-white"><span className="font-semibold">COMS</span>
              <button onClick={() => setOpen(false)} className="p-2 text-xl leading-none" aria-label="Tutup menu">×</button></div>
            {nav}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-5">
          <button className="btn-ghost px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu">☰</button>
          <span className="font-semibold text-brand-800 lg:hidden">COMS</span>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notifikasi" className="btn-ghost relative px-2.5" aria-label={`Notifikasi, ${count} belum dibaca`}>
              <span aria-hidden className="text-lg">🔔</span>
              {count > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 99 ? "99+" : count}</span>}
            </Link>
            <Link href="/profil" className="btn-ghost max-w-48 flex-col items-end gap-0 px-2 py-1 leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="hidden truncate text-[11px] text-slate-500 sm:block">{user.roles}</span>
            </Link>
            <form action={logout}><button className="btn-ghost px-2 text-sm" type="submit">Keluar</button></form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
