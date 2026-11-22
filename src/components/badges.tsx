import { Badge, type Tone } from "./ui";
import { PROPERTY_STATUS_LABEL, type PropertyStatus } from "@/services/properties";

const PROPERTY_TONE: Record<PropertyStatus, Tone> = { active: "green", temporarily_unavailable: "yellow", under_maintenance: "yellow", inactive: "gray" };
export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return <Badge tone={PROPERTY_TONE[status]}>{PROPERTY_STATUS_LABEL[status]}</Badge>;
}
export const SCOPE_SHORT = { own: "Sendiri", assigned: "Ditugaskan", department: "Departemen", all: "Semua" } as const;
