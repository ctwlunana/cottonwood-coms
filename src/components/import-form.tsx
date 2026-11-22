"use client";
import { ActionForm, SubmitButton } from "./forms";
import type { ActionState } from "@/lib/action";

export function ImportForm({ action, kind }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; kind: "villas" | "employees" }) {
  return (
    <ActionForm action={action} render={(s) => {
      const creds = s?.ok ? (s.data as { employeeCode: string; username: string; temporaryPassword: string }[] | null) : null;
      if (!creds?.length) return null;
      const csv = "employee_code,username,temporary_password\n" + creds.map((c) => `${c.employeeCode},${c.username},${c.temporaryPassword}`).join("\n");
      return (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">Password sementara (hanya tampil sekali). Unduh dan bagikan secara pribadi:</p>
          <a className="btn-secondary mt-2" download="password-sementara.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Unduh daftar password</a>
          <table className="mt-2 w-full text-xs"><tbody>{creds.map((c) => <tr key={c.username}><td>{c.employeeCode}</td><td>{c.username}</td><td className="font-mono">{c.temporaryPassword}</td></tr>)}</tbody></table>
        </div>
      );
    }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="validate" className="btn-secondary">Validasi saja</button>
        <SubmitButton pendingText="Mengimpor…">Impor sekarang</SubmitButton>
      </div>
      <input type="hidden" name="mode" value="commit" />
    </ActionForm>
  );
}
