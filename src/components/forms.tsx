"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Pending state of the surrounding ActionForm (it submits manually, so useFormStatus alone can't see it). */
const PendingContext = createContext(false);

export function SubmitButton({ children, className = "btn-primary", pendingText = "Menyimpan…" }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending: formPending } = useFormStatus();
  const pending = useContext(PendingContext) || formPending;
  return <button type="submit" className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}

export function Alert({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>;
  if (state.ok && state.message) return <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</div>;
  return null;
}

/**
 * Form bound to a server action with inline error/success feedback.
 * `confirm` shows a confirmation dialog before submitting important actions.
 */
export function ActionForm({ action, children, className = "space-y-4", confirm, resetOnSuccess, render }: {
  action: Action; children?: ReactNode; className?: string; confirm?: string; resetOnSuccess?: boolean;
  render?: (state: ActionState) => ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <PendingContext.Provider value={isPending}>
      <form
        ref={ref}
        className={className}
        // Submit manually instead of <form action>: React 19 resets uncontrolled fields after every
        // action, which would wipe what the user typed when the server returns a validation error.
        onSubmit={(e) => {
          e.preventDefault();
          if (isPending) return;
          if (confirm && !window.confirm(confirm)) return;
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const fd = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(fd));
        }}
      >
        <Alert state={state} />
        {children}
        {render?.(state)}
      </form>
    </PendingContext.Provider>
  );
}

/** Single-button form (e.g. "Nonaktifkan"), always with confirmation. */
export function ConfirmButton({ action, hidden, label, confirm, className = "btn-secondary" }: {
  action: Action; hidden?: Record<string, string>; label: string; confirm: string; className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} onSubmit={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }} className="inline-flex flex-col gap-1">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton className={className} pendingText="Memproses…">{label}</SubmitButton>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Auto-submit a select when it changes (filters). */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Image input with client-side preview + type/size validation (server re-validates). */
export function PhotoInput({ name = "files", maxMb = 10, multiple = true }: { name?: string; maxMb?: number; multiple?: boolean }) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <input
        type="file" name={name} accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" capture="environment" multiple={multiple}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          const big = files.find((f) => f.size > maxMb * 1024 * 1024);
          setErr(big ? `${big.name} melebihi ${maxMb} MB` : null);
          if (big) e.currentTarget.value = "";
          previews.forEach(URL.revokeObjectURL);
          setPreviews(big ? [] : files.filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f)));
        }}
      />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {previews.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previews.map((p) => <img key={p} src={p} alt="Pratinjau" className="aspect-square w-full rounded-lg object-cover" />)}
        </div>
      )}
    </div>
  );
}
