import { Badge, type Tone } from "./ui";
import { PROPERTY_STATUS_LABEL, type PropertyStatus } from "@/services/properties";

const PROPERTY_TONE: Record<PropertyStatus, Tone> = { active: "green", temporarily_unavailable: "yellow", under_maintenance: "yellow", inactive: "gray" };
export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return <Badge tone={PROPERTY_TONE[status]}>{PROPERTY_STATUS_LABEL[status]}</Badge>;
}
export const SCOPE_SHORT = { own: "Sendiri", assigned: "Ditugaskan", department: "Departemen", all: "Semua" } as const;

import { PRIORITY_LABEL, PRIORITY_TONE, WO_STATUS_LABEL, WO_STATUS_TONE, HK_STATUS_LABEL, HK_STATUS_TONE, type WoStatus, type HkStatus, type Priority } from "@/lib/labels";
export function PriorityBadge({ p }: { p: Priority }) {
  return p === "normal" ? null : <Badge tone={PRIORITY_TONE[p]}>{PRIORITY_LABEL[p]}</Badge>;
}
export function WoStatusBadge({ s }: { s: WoStatus }) {
  return <Badge tone={WO_STATUS_TONE[s]}>{WO_STATUS_LABEL[s]}</Badge>;
}
export function HkStatusBadge({ s }: { s: HkStatus }) {
  return <Badge tone={HK_STATUS_TONE[s]}>{HK_STATUS_LABEL[s]}</Badge>;
}
