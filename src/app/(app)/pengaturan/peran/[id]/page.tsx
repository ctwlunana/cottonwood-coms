import { db } from "@/db";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/authz";
import { load } from "@/lib/page";
import { getMatrix } from "@/services/rbac";
import { listAudit } from "@/services/audit";
import { FINANCIAL_PERMISSIONS, SCOPES, SCOPE_LABEL } from "@/lib/permissions";
import { PageHeader, Card, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AuditList } from "@/components/audit-list";
import { Forbidden } from "@/components/forbidden";
import { notFound } from "next/navigation";
import { saveRolePermissionsAction } from "../../actions";

export default async function RoleEdit({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const res = await load(() => getMatrix(db, actor));
  if (!res.ok) return <Forbidden message={res.denied} />;
  const { roles, permissions, grants } = res.data;
  const role = roles.find((r) => r.id === id);
  if (!role) notFound();
  const fin = new Set<string>(FINANCIAL_PERMISSIONS);
  const gmLevel = can(actor, "approval.rule_manage");
  const own = actor.roleSlugs.includes(role.slug);
  const history = await listAudit(db, actor, { entityType: "role", entityId: id }).catch(() => null);
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <>
      <PageHeader title={role.name} subtitle={role.description} back={{ href: "/pengaturan/peran", label: "Matriks hak akses" }} />
      {own && !gmLevel && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Anda memiliki peran ini, sehingga tidak dapat mengubah hak aksesnya.</p>}
      <ActionForm action={saveRolePermissionsAction} confirm="Simpan perubahan hak akses? Berlaku langsung untuk semua pemegang peran ini.">
        <input type="hidden" name="roleId" value={id} />
        <div className="grid gap-4 lg:grid-cols-2">
          {modules.map((m) => (
            <Card key={m} title={m}>
              <ul className="space-y-2">
                {permissions.filter((p) => p.module === m).map((p) => {
                  const cur = grants.get(`${id}|${p.code}`) ?? "";
                  const locked = (fin.has(p.code) || own) && !gmLevel;
                  return (
                    <li key={p.code} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-sm">{p.description} {fin.has(p.code) && <Badge tone="yellow">Keuangan</Badge>}
                        <div className="font-mono text-[10px] text-slate-400">{p.code}{p.stage > 1 && ` · modul tahap ${p.stage}`}</div></div>
                      {locked && <input type="hidden" name={`p:${p.code}`} value={cur} />}
                      {p.scoped ? (
                        <select name={locked ? undefined : `p:${p.code}`} defaultValue={cur} disabled={locked} className="input w-44 shrink-0 text-xs">
                          <option value="">— Tidak ada —</option>
                          {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                        </select>
                      ) : (
                        <input type="checkbox" name={locked ? undefined : `p:${p.code}`} value="all" defaultChecked={cur !== ""} disabled={locked} className="h-5 w-5 shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-slate-200 bg-white/95 px-4 py-3"><SubmitButton>Simpan hak akses</SubmitButton></div>
      </ActionForm>
      {history && <Card title="Riwayat perubahan" className="mt-6"><AuditList rows={history.rows.map((r) => ({ id: r.log.id, action: r.log.action, at: r.log.at, user: r.user, before: r.log.before, after: r.log.after }))} /></Card>}
    </>
  );
}
