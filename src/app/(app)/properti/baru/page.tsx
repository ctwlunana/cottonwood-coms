import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { requirePermission } from "@/lib/authz";
import { listLocations } from "@/services/properties";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "@/components/property-form";
import { createPropertyAction } from "../actions";
import { Forbidden } from "@/components/forbidden";

export const metadata = { title: "Villa baru" };

export default async function NewProperty() {
  const actor = await requireActor();
  try { requirePermission(actor, "property.manage"); } catch { return <Forbidden />; }
  const locs = (await listLocations(db, actor)).filter((l) => l.isActive);
  return (
    <>
      <PageHeader title="Tambah villa" back={{ href: "/properti", label: "Properti" }} />
      <PropertyForm action={createPropertyAction} locations={locs} submit="Simpan villa" />
    </>
  );
}
