/** Two-way decision as radio cards (explicit, works with any submit method). */
export function Decision({ name, options }: { name: string; options: [value: string, label: string, tone: "good" | "bad"][] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(([v, l, tone]) => (
        <label key={v} className="block">
          <input type="radio" name={name} value={v} required className="peer sr-only" />
          <span className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 text-center text-sm font-medium ${tone === "good" ? "peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-checked:text-white" : "peer-checked:border-red-600 peer-checked:bg-red-600 peer-checked:text-white"}`}>{l}</span>
        </label>
      ))}
    </div>
  );
}
