export const TZ = "Asia/Jakarta";

const dtf = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, dateStyle: "medium" });
const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dtf.format(typeof d === "string" ? new Date(d) : d);
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return df.format(typeof d === "string" ? new Date(d) : d);
}
export function fmtIDR(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return idr.format(Number(v));
}
export function fmtRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return fmtDateTime(d);
}
