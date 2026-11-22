import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { requirePermission } from "@/lib/authz";
import { load } from "@/lib/page";
import { getProperty, listLocations } from "@/services/properties";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "@/components/property-form";
import { Forbidden } from "@/components/forbidden";
import { updatePropertyAction } from "../../actions";

export default async function EditProperty({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(async () => {
    requirePermission(actor, "property.manage");
    return { d: await getProperty(db, actor, id), locs: await listLocations(db, actor) };
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { d, locs } = res.data;
  return (
    <>
      <PageHeader title={`Ubah ${d.property.name}`} back={{ href: `/properti/${id}`, label: d.property.name }} />
      <PropertyForm action={updatePropertyAction} locations={locs.filter((l) => l.isActive || l.id === d.property.locationId)} p={d.property} submit="Simpan perubahan" />
    </>
  );
}
