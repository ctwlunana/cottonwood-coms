import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { load } from "@/lib/page";
import { requirePermission } from "@/lib/authz";
import { listTeams } from "@/services/housekeeping";
import { listLocations } from "@/services/properties";
import { usersWithRoles } from "@/services/lookup";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Forbidden } from "@/components/forbidden";
import { teamAction } from "../actions";

export const metadata = { title: "Tim housekeeping" };

export default async function TeamsPage() {
  const actor = await requireActor();
  const res = await load(async () => {
    requirePermission(actor, "housekeeping.team_manage");
    return Promise.all([listTeams(db, actor), listLocations(db, actor), usersWithRoles(db, ["housekeeper", "hk_team_leader"]), usersWithRoles(db, ["hk_team_leader"])]);
  });
  if (!res.ok) return <Forbidden message={res.denied} />;
  const [teams, locs, workers, leaders] = res.data;
  const form = (t?: (typeof teams)[number]) => (
    <ActionForm action={teamAction} resetOnSuccess={!t}>
      {t && <input type="hidden" name="id" value={t.t.id} />}
      <input name="name" className="input" placeholder="Nama tim" defaultValue={t?.t.name} required />
      <div className="grid grid-cols-2 gap-2">
        <select name="locationId" className="input" defaultValue={t?.t.locationId ?? ""}><option value="">— Area —</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select name="leaderId" className="input" defaultValue={t?.t.leaderId ?? ""}><option value="">— Team Leader —</option>{leaders.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}</select>
      </div>
      <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
        {workers.map((w) => <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="memberIds" value={w.id} defaultChecked={t?.members.some((m) => m.id === w.id)} /> {w.fullName}</label>)}
      </div>
      <SubmitButton className="btn-secondary">{t ? "Simpan" : "Buat tim"}</SubmitButton>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Tim housekeeping" back={{ href: "/housekeeping", label: "Housekeeping" }} />
      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((t) => <Card key={t.t.id} title={`${t.t.name} · ${t.members.length} anggota`}>{form(t)}</Card>)}
        <Card title="Tim baru">{form()}</Card>
      </div>
    </>
  );
}
