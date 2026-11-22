import type { Tone } from "@/components/ui";

export const PRIORITY_LABEL = { critical: "Kritis", high: "Tinggi", normal: "Normal", low: "Rendah" } as const;
export const PRIORITY_TONE: Record<keyof typeof PRIORITY_LABEL, Tone> = { critical: "red", high: "yellow", normal: "gray", low: "gray" };
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORY_LABEL = {
  plumbing: "Air / pipa / bocor", electrical: "Listrik", ac: "AC", pool: "Kolam renang", garden: "Taman",
  furniture: "Furnitur", appliance: "Peralatan elektronik", structure: "Bangunan / atap", pest: "Hama", safety: "Keselamatan", other: "Lainnya",
} as const;
export type MaintenanceCategory = keyof typeof CATEGORY_LABEL;
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as MaintenanceCategory[];

export const WO_STATUS_LABEL = {
  new: "Baru", under_review: "Ditinjau", assigned: "Ditugaskan", in_progress: "Dikerjakan", waiting_parts: "Menunggu suku cadang",
  waiting_approval: "Menunggu persetujuan", completed: "Selesai dikerjakan", verified: "Terverifikasi", closed: "Ditutup", cancelled: "Dibatalkan",
} as const;
export type WoStatus = keyof typeof WO_STATUS_LABEL;
export const WO_STATUS_TONE: Record<WoStatus, Tone> = {
  new: "blue", under_review: "blue", assigned: "purple", in_progress: "yellow", waiting_parts: "yellow", waiting_approval: "yellow",
  completed: "green", verified: "green", closed: "gray", cancelled: "gray",
};
export const WO_OPEN: WoStatus[] = ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval", "completed", "verified"];

export const MR_STATUS_LABEL = { pending_review: "Menunggu tinjauan", converted: "Jadi work order", merged: "Digabung (duplikat)", rejected: "Ditolak" } as const;

export const HK_STATUS_LABEL = {
  pending: "Menunggu", assigned: "Ditugaskan", in_progress: "Sedang dibersihkan", cleaning_completed: "Pembersihan selesai",
  inspection_required: "Perlu inspeksi", inspection_failed: "Inspeksi gagal", reclean_required: "Perlu dibersihkan ulang",
  ready: "Siap untuk tamu", cancelled: "Dibatalkan",
} as const;
export type HkStatus = keyof typeof HK_STATUS_LABEL;
export const HK_STATUS_TONE: Record<HkStatus, Tone> = {
  pending: "gray", assigned: "purple", in_progress: "yellow", cleaning_completed: "blue", inspection_required: "blue",
  inspection_failed: "red", reclean_required: "red", ready: "green", cancelled: "gray",
};
export const ANSWER_LABEL = { yes: "Ya / Baik", no: "Tidak / Bermasalah", na: "Tidak berlaku" } as const;
