import { fmtDateTime } from "@/lib/format";

type Att = { id: string; mime: string; originalName: string | null; kind: string; createdAt: Date };
const KIND: Record<string, string> = { before: "Sebelum", after: "Sesudah", finding: "Temuan", completion: "Hasil", inspection: "Inspeksi", photo: "Foto" };

/** Thumbnail grid for record photos (served through the authorized attachment route). */
export function PhotoGrid({ files, empty = "Belum ada foto." }: { files: Att[]; empty?: string }) {
  if (!files.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {files.map((f) => (
        <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="group relative block">
          {f.mime.startsWith("image/") && f.mime !== "image/heic"
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/attachments/${f.id}`} alt={f.originalName ?? "Foto"} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
            : <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-1 text-center text-[10px]">{f.originalName}</div>}
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{KIND[f.kind] ?? f.kind}</span>
          <span className="sr-only">{fmtDateTime(f.createdAt)}</span>
        </a>
      ))}
    </div>
  );
}
