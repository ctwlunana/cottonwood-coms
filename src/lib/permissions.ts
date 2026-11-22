/**
 * Permission catalog — the single source of truth for permission codes.
 * Synced into the `permissions` table by the seed script. The role ⇄
 * permission matrix (with scope) is stored in `role_permissions` and is
 * editable at runtime; DEFAULT_ROLES below only provides the initial matrix.
 *
 * Scope semantics (for `scoped: true` permissions):
 *   own        – records the user created / is assigned to
 *   assigned   – records belonging to villas assigned to the user
 *                (property_assignments, or locations they are PIC of)
 *   department – records of the user's department
 *   all        – company wide
 * For non-scoped permissions the scope is stored as "all" and ignored.
 */

export const SCOPES = ["own", "assigned", "department", "all"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_RANK: Record<Scope, number> = { own: 1, assigned: 2, department: 3, all: 4 };
export const SCOPE_LABEL: Record<Scope, string> = {
  own: "Milik sendiri",
  assigned: "Villa yang ditugaskan",
  department: "Departemen",
  all: "Seluruh perusahaan",
};

type PermDef = { module: string; description: string; scoped?: boolean; stage: number };

export const PERMISSIONS = {
  // --- Core / administration (Stage 1)
  "dashboard.view": { module: "Dashboard", description: "Melihat dashboard kerja", stage: 1 },
  "dashboard.gm": { module: "Dashboard", description: "Melihat dashboard eksekutif seluruh perusahaan", stage: 6 },
  "property.view": { module: "Properti", description: "Melihat data villa", scoped: true, stage: 1 },
  "property.manage": { module: "Properti", description: "Membuat / mengubah villa & lokasi", stage: 1 },
  "property.assign": { module: "Properti", description: "Menugaskan Villa Keeper / PIC Lokasi", stage: 1 },
  "employee.view": { module: "Karyawan", description: "Melihat data karyawan", scoped: true, stage: 1 },
  "employee.manage": { module: "Karyawan", description: "Membuat / mengubah / menonaktifkan karyawan", stage: 1 },
  "employee.reset_password": { module: "Karyawan", description: "Menerbitkan link reset password karyawan", stage: 1 },
  "rbac.manage": { module: "Pengaturan", description: "Mengatur peran, matriks hak akses & penugasan peran", stage: 1 },
  "department.manage": { module: "Pengaturan", description: "Mengatur departemen", stage: 1 },
  "settings.manage": { module: "Pengaturan", description: "Mengubah pengaturan sistem", stage: 1 },
  "audit.view": { module: "Audit", description: "Melihat audit trail", scoped: true, stage: 1 },
  "import.run": { module: "Pengaturan", description: "Menjalankan impor CSV (villa, karyawan)", stage: 1 },

  // --- Property operations (Stage 2)
  "checklist.submit": { module: "Checklist", description: "Mengisi checklist harian villa", stage: 2 },
  "checklist.view": { module: "Checklist", description: "Melihat hasil checklist", scoped: true, stage: 2 },
  "checklist.template_manage": { module: "Checklist", description: "Mengatur template checklist", stage: 2 },
  "maintenance.report": { module: "Maintenance", description: "Melaporkan masalah / membuat permintaan maintenance", stage: 2 },
  "maintenance.view": { module: "Maintenance", description: "Melihat work order", scoped: true, stage: 2 },
  "maintenance.review": { module: "Maintenance", description: "Meninjau permintaan & membuat work order", stage: 2 },
  "maintenance.assign": { module: "Maintenance", description: "Menugaskan engineer / vendor", stage: 2 },
  "maintenance.work": { module: "Maintenance", description: "Mengerjakan & memperbarui work order", stage: 2 },
  "maintenance.verify": { module: "Maintenance", description: "Memverifikasi & menutup work order", stage: 2 },
  "maintenance.keeper_confirm": { module: "Maintenance", description: "Konfirmasi kondisi villa setelah perbaikan", stage: 2 },
  "maintenance.pm_manage": { module: "Maintenance", description: "Mengatur peralatan & jadwal preventive", stage: 2 },
  "housekeeping.view": { module: "Housekeeping", description: "Melihat jadwal housekeeping", scoped: true, stage: 2 },
  "housekeeping.schedule": { module: "Housekeeping", description: "Membuat jadwal & penugasan tim", stage: 2 },
  "housekeeping.assign": { module: "Housekeeping", description: "Menugaskan housekeeper", stage: 2 },
  "housekeeping.work": { module: "Housekeeping", description: "Memperbarui status pembersihan", stage: 2 },
  "housekeeping.inspect": { module: "Housekeeping", description: "Inspeksi kesiapan villa", stage: 2 },
  "housekeeping.team_manage": { module: "Housekeeping", description: "Mengatur tim housekeeping", stage: 2 },

  // --- Customer service & Lost & Found (Stage 3)
  "cs.case_view": { module: "Customer Service", description: "Melihat kasus tamu", scoped: true, stage: 3 },
  "cs.case_create": { module: "Customer Service", description: "Membuat kasus tamu", stage: 3 },
  "cs.case_manage": { module: "Customer Service", description: "Mengelola & menutup kasus tamu", scoped: true, stage: 3 },
  "cs.case_assign": { module: "Customer Service", description: "Menugaskan kasus / tugas ke departemen", stage: 3 },
  "cs.guest_pii_view": { module: "Customer Service", description: "Melihat data pribadi tamu (kontak, alamat, booking ref)", stage: 3 },
  "cs.task_work": { module: "Customer Service", description: "Mengerjakan tugas yang diberikan dari kasus", stage: 3 },
  "cs.shift_report": { module: "Customer Service", description: "Membuat laporan shift & handover", stage: 3 },
  "cs.shift_review": { module: "Customer Service", description: "Meninjau semua laporan shift", stage: 3 },
  "lostfound.report": { module: "Lost & Found", description: "Melaporkan barang tertinggal", stage: 3 },
  "lostfound.view": { module: "Lost & Found", description: "Melihat Lost & Found", scoped: true, stage: 3 },
  "lostfound.manage": { module: "Lost & Found", description: "Mengelola serah terima & pengiriman", scoped: true, stage: 3 },

  // --- Inventory & purchasing (Stage 4)
  "inventory.view": { module: "Inventory", description: "Melihat stok", scoped: true, stage: 4 },
  "inventory.request": { module: "Inventory", description: "Mengajukan permintaan stok villa", stage: 4 },
  "inventory.request_approve": { module: "Inventory", description: "Menyetujui permintaan stok", stage: 4 },
  "inventory.issue": { module: "Inventory", description: "Menyiapkan & mengeluarkan barang", stage: 4 },
  "inventory.receive_confirm": { module: "Inventory", description: "Konfirmasi penerimaan barang di villa", stage: 4 },
  "inventory.adjust_request": { module: "Inventory", description: "Mengajukan penyesuaian stok", stage: 4 },
  "inventory.adjust_approve": { module: "Inventory", description: "Menyetujui penyesuaian stok", stage: 4 },
  "inventory.item_manage": { module: "Inventory", description: "Mengatur master barang & par stock", stage: 4 },
  "purchasing.pr_create": { module: "Purchasing", description: "Membuat purchase request", stage: 4 },
  "purchasing.pr_view": { module: "Purchasing", description: "Melihat purchase request", scoped: true, stage: 4 },
  "purchasing.pr_validate": { module: "Purchasing", description: "Validasi kebutuhan PR (supervisor)", stage: 4 },
  "purchasing.manage": { module: "Purchasing", description: "Quotation, PO, tracking pengiriman, invoice", stage: 4 },
  "purchasing.grn": { module: "Purchasing", description: "Mencatat penerimaan barang (GRN)", stage: 4 },
  "purchasing.supplier_manage": { module: "Purchasing", description: "Mengelola data supplier", stage: 4 },
  "purchasing.supplier_bank_verify": { module: "Purchasing", description: "Verifikasi independen rekening supplier", stage: 4 },

  // --- Finance, accounting, approvals (Stage 5)
  "finance.view": { module: "Finance", description: "Melihat antrian pembayaran", stage: 5 },
  "finance.payment_process": { module: "Finance", description: "Memproses pembayaran & bukti bayar", stage: 5 },
  "finance.pettycash_manage": { module: "Finance", description: "Mengelola & mengisi ulang petty cash", stage: 5 },
  "pettycash.custodian": { module: "Finance", description: "Memegang float petty cash", stage: 5 },
  "pettycash.claim": { module: "Finance", description: "Mengajukan klaim pengeluaran kecil", stage: 5 },
  "accounting.view": { module: "Accounting", description: "Melihat catatan akuntansi", stage: 5 },
  "accounting.record": { module: "Accounting", description: "Mencatat pendapatan & pengeluaran", stage: 5 },
  "accounting.reconcile": { module: "Accounting", description: "Rekonsiliasi pembayaran & petty cash", stage: 5 },
  "approval.view": { module: "Approval", description: "Melihat Approval Center", scoped: true, stage: 5 },
  "approval.decide": { module: "Approval", description: "Memutuskan approval (sesuai aturan approval)", stage: 5 },
  "approval.rule_manage": { module: "Approval", description: "Mengatur aturan & ambang approval", stage: 5 },

  // --- Reports & notifications (Stage 6)
  "report.view": { module: "Laporan", description: "Melihat laporan", scoped: true, stage: 6 },
  "report.export": { module: "Laporan", description: "Ekspor laporan CSV/Excel", stage: 6 },
  "notification.rule_manage": { module: "Notifikasi", description: "Mengatur aturan pengingat & eskalasi", stage: 6 },
} as const satisfies Record<string, PermDef>;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];
export function isScoped(code: PermissionCode): boolean {
  return Boolean((PERMISSIONS[code] as PermDef).scoped);
}

/** Permissions that grant money / approval authority. Never auto-granted to sysadmin. */
export const FINANCIAL_PERMISSIONS: PermissionCode[] = [
  "approval.decide",
  "approval.rule_manage",
  "finance.view",
  "finance.payment_process",
  "finance.pettycash_manage",
  "pettycash.custodian",
  "accounting.view",
  "accounting.record",
  "accounting.reconcile",
];

type Grant = PermissionCode | [PermissionCode, Scope];
type RoleDef = { slug: string; name: string; department: string; description: string; grants: Grant[] };

const ALL_VIEW: Grant[] = [
  ["property.view", "all"],
  ["employee.view", "all"],
  ["checklist.view", "all"],
  ["maintenance.view", "all"],
  ["housekeeping.view", "all"],
  ["cs.case_view", "all"],
  ["lostfound.view", "all"],
  ["inventory.view", "all"],
  ["purchasing.pr_view", "all"],
  ["approval.view", "all"],
  ["report.view", "all"],
];

export const DEPARTMENTS = [
  { code: "MGT", name: "Manajemen" },
  { code: "PROP", name: "Property Operations" },
  { code: "ENG", name: "Engineering" },
  { code: "HK", name: "Housekeeping" },
  { code: "INV", name: "Inventory" },
  { code: "PUR", name: "Purchasing" },
  { code: "CS", name: "Customer Service" },
  { code: "FIN", name: "Finance" },
  { code: "ACC", name: "Accounting" },
  { code: "IT", name: "IT / Administrasi Sistem" },
] as const;

export const DEFAULT_ROLES: RoleDef[] = [
  {
    slug: "gm", name: "General Manager", department: "MGT",
    description: "Akses seluruh perusahaan, approval, KPI, eskalasi.",
    grants: [
      "dashboard.view", "dashboard.gm", ...ALL_VIEW, ["audit.view", "all"],
      "property.manage", "property.assign", "employee.manage", "employee.reset_password",
      "rbac.manage", "department.manage", "settings.manage",
      "approval.decide", "approval.rule_manage", "finance.view", "accounting.view",
      ["cs.case_manage", "all"], "cs.case_assign", "cs.guest_pii_view", "cs.shift_review",
      "report.export", "notification.rule_manage",
    ],
  },
  {
    slug: "supervisor_villa", name: "Supervisor Villa", department: "PROP",
    description: "Mengawasi seluruh Villa Keeper dan kondisi villa.",
    grants: [
      "dashboard.view", ["property.view", "all"], "property.assign", ["employee.view", "department"],
      "checklist.submit", ["checklist.view", "all"], "checklist.template_manage",
      "maintenance.report", ["maintenance.view", "all"], "maintenance.keeper_confirm",
      ["housekeeping.view", "all"], "housekeeping.inspect",
      "lostfound.report", ["lostfound.view", "all"], ["lostfound.manage", "all"],
      ["inventory.view", "all"], "inventory.request", "inventory.receive_confirm",
      "purchasing.pr_create", ["purchasing.pr_view", "department"], "purchasing.pr_validate",
      "pettycash.custodian", "pettycash.claim", ["approval.view", "department"], "cs.task_work",
      ["report.view", "department"],
    ],
  },
  {
    slug: "location_pic", name: "PIC Lokasi", department: "PROP",
    description: "Koordinator Villa Keeper di satu klaster lokasi. Tanpa otoritas keuangan.",
    grants: [
      "dashboard.view", ["property.view", "assigned"], ["employee.view", "department"],
      "checklist.submit", ["checklist.view", "assigned"], "maintenance.report", ["maintenance.view", "assigned"],
      "maintenance.keeper_confirm", ["housekeeping.view", "assigned"], "housekeeping.inspect",
      "lostfound.report", ["lostfound.view", "assigned"], ["inventory.view", "assigned"],
      "inventory.request", "inventory.receive_confirm", "cs.task_work",
    ],
  },
  {
    slug: "villa_keeper", name: "Villa Keeper", department: "PROP",
    description: "Merawat & menginspeksi villa yang ditugaskan.",
    grants: [
      "dashboard.view", ["property.view", "assigned"], "checklist.submit", ["checklist.view", "own"],
      "maintenance.report", ["maintenance.view", "assigned"], "maintenance.keeper_confirm",
      ["housekeeping.view", "assigned"], "housekeeping.inspect",
      "lostfound.report", ["lostfound.view", "assigned"], ["lostfound.manage", "assigned"],
      ["inventory.view", "assigned"], "inventory.request", "inventory.receive_confirm",
      "pettycash.claim", "cs.task_work",
    ],
  },
  {
    slug: "supervisor_engineer", name: "Supervisor Engineer", department: "ENG",
    description: "Meninjau permintaan, membuat & menugaskan work order, verifikasi.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["employee.view", "department"],
      "maintenance.report", ["maintenance.view", "all"], "maintenance.review", "maintenance.assign",
      "maintenance.work", "maintenance.verify", "maintenance.pm_manage", ["checklist.view", "all"],
      ["inventory.view", "all"], "purchasing.pr_create", ["purchasing.pr_view", "department"],
      "purchasing.pr_validate", ["approval.view", "department"], "cs.task_work", ["report.view", "department"],
    ],
  },
  {
    slug: "engineer", name: "Engineer", department: "ENG",
    description: "Mengerjakan work order yang ditugaskan.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["maintenance.view", "own"], "maintenance.work",
      "maintenance.report", "purchasing.pr_create", ["purchasing.pr_view", "own"], "cs.task_work",
    ],
  },
  {
    slug: "hk_coordinator", name: "Koordinator Housekeeping", department: "HK",
    description: "Mengatur manpower, jadwal harian & kualitas pembersihan.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["employee.view", "department"],
      ["housekeeping.view", "all"], "housekeeping.schedule", "housekeeping.assign",
      "housekeeping.inspect", "housekeeping.team_manage", "maintenance.report",
      "lostfound.report", "purchasing.pr_create", ["purchasing.pr_view", "department"],
      "purchasing.pr_validate", "cs.task_work", ["report.view", "department"],
    ],
  },
  {
    slug: "hk_team_leader", name: "Team Leader Housekeeping", department: "HK",
    description: "Menugaskan housekeeper di tim / area.",
    grants: [
      "dashboard.view", ["property.view", "assigned"], ["employee.view", "department"],
      ["housekeeping.view", "department"], "housekeeping.assign", "housekeeping.work",
      "housekeeping.inspect", "maintenance.report", "lostfound.report", "cs.task_work",
    ],
  },
  {
    slug: "housekeeper", name: "Housekeeper", department: "HK",
    description: "Menerima tugas pembersihan dan memperbarui status.",
    grants: ["dashboard.view", ["housekeeping.view", "own"], "housekeeping.work", "maintenance.report", "lostfound.report"],
  },
  {
    slug: "supervisor_inventory", name: "Supervisor Inventory", department: "INV",
    description: "Kontrol stok, approval permintaan & pergerakan stok.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["employee.view", "department"],
      ["inventory.view", "all"], "inventory.request_approve", "inventory.adjust_approve",
      "inventory.adjust_request", "inventory.item_manage", "purchasing.pr_create",
      ["purchasing.pr_view", "department"], "purchasing.pr_validate", ["report.view", "department"],
    ],
  },
  {
    slug: "inventory_staff", name: "Staff Inventory", department: "INV",
    description: "Menyiapkan, mengeluarkan & menerima barang.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["inventory.view", "all"], "inventory.issue",
      "inventory.adjust_request", "purchasing.grn", "purchasing.pr_create", ["purchasing.pr_view", "own"],
    ],
  },
  {
    slug: "purchasing_officer", name: "Purchasing Officer", department: "PUR",
    description: "Quotation, PO, tracking pengiriman, invoice supplier. Tidak dapat menyetujui pembelian sendiri.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["purchasing.pr_view", "all"], "purchasing.manage",
      "purchasing.supplier_manage", "purchasing.grn", ["inventory.view", "all"],
    ],
  },
  {
    slug: "cs_lead", name: "CS Lead", department: "CS",
    description: "Mengawasi seluruh CS, kasus terbuka, shift report & eskalasi.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["employee.view", "department"],
      ["cs.case_view", "all"], "cs.case_create", ["cs.case_manage", "all"], "cs.case_assign",
      "cs.guest_pii_view", "cs.shift_report", "cs.shift_review", ["lostfound.view", "all"],
      ["lostfound.manage", "all"], "maintenance.report", ["maintenance.view", "all"],
      ["housekeeping.view", "all"], ["approval.view", "department"], ["report.view", "department"],
    ],
  },
  {
    slug: "cs_staff", name: "CS Staff", department: "CS",
    description: "Menangani tamu, kasus, dan handover shift. Tidak dapat menyetujui refund.",
    grants: [
      "dashboard.view", ["property.view", "all"], ["cs.case_view", "all"], "cs.case_create",
      ["cs.case_manage", "own"], "cs.guest_pii_view", "cs.shift_report", ["lostfound.view", "all"],
      ["lostfound.manage", "all"], "maintenance.report", ["maintenance.view", "all"],
      ["housekeeping.view", "all"],
    ],
  },
  {
    slug: "finance", name: "Finance", department: "FIN",
    description: "Memproses pembayaran yang sudah disetujui. Tidak dapat menyetujui pembayaran sendiri.",
    grants: [
      "dashboard.view", "finance.view", "finance.payment_process", "finance.pettycash_manage",
      ["purchasing.pr_view", "all"], ["approval.view", "all"],
    ],
  },
  {
    slug: "accounting", name: "Accounting", department: "ACC",
    description: "Pencatatan & rekonsiliasi independen.",
    grants: [
      "dashboard.view", "accounting.view", "accounting.record", "accounting.reconcile",
      "finance.view", ["purchasing.pr_view", "all"], ["approval.view", "all"], ["report.view", "all"], "report.export",
    ],
  },
  {
    slug: "sysadmin", name: "System Administrator", department: "IT",
    description: "Administrasi akun, peran & konfigurasi. TIDAK memiliki otoritas approval / keuangan.",
    grants: [
      "dashboard.view", ["employee.view", "all"], "employee.manage", "employee.reset_password",
      "rbac.manage", "department.manage", "settings.manage", "import.run", ["audit.view", "all"],
      ["property.view", "all"], "property.manage", "property.assign",
    ],
  },
];

export function normalizeGrant(g: Grant): { code: PermissionCode; scope: Scope } {
  if (Array.isArray(g)) return { code: g[0], scope: isScoped(g[0]) ? g[1] : "all" };
  return { code: g, scope: "all" };
}
