import type { Actor } from "@/lib/authz";
import type { PermissionCode } from "@/lib/permissions";

export type NavItem = { href: string; label: string; icon: string; anyOf: PermissionCode[]; group: "kerja" | "manajemen" | "admin" };

/**
 * Only modules that are actually implemented appear here; each is shown only if the
 * user holds at least one of `anyOf`. (Server-side checks still apply on every page.)
 * Later stages append their modules (Maintenance, Housekeeping, CS, ...).
 */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", anyOf: ["dashboard.view"], group: "kerja" },
  { href: "/notifikasi", label: "Notifikasi", icon: "◔", anyOf: ["dashboard.view"], group: "kerja" },
  { href: "/properti", label: "Properti / Villa", icon: "⌂", anyOf: ["property.view"], group: "kerja" },
  { href: "/lokasi", label: "Lokasi", icon: "⌖", anyOf: ["property.view"], group: "kerja" },
  { href: "/karyawan", label: "Karyawan", icon: "☺", anyOf: ["employee.view"], group: "manajemen" },
  { href: "/audit", label: "Audit Trail", icon: "≣", anyOf: ["audit.view"], group: "manajemen" },
  { href: "/pengaturan", label: "Pengaturan", icon: "⚙", anyOf: ["settings.manage", "rbac.manage", "department.manage", "import.run"], group: "admin" },
];

export function navFor(actor: Actor) {
  return NAV.filter((n) => n.anyOf.some((p) => actor.perms.has(p)));
}
export const GROUP_LABEL = { kerja: "Operasional", manajemen: "Manajemen", admin: "Administrasi" } as const;
