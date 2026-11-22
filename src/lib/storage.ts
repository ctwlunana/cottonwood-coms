import { isWorkers, cfEnv } from "./runtime";

/** Object storage: Cloudflare R2 in production (Workers), local disk under Node (dev/tests/scripts). */
export interface Storage {
  put(data: Uint8Array, ext: string, opts?: { prefix?: string; key?: string; contentType?: string }): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  list(prefix: string): Promise<{ key: string; size: number; uploaded: Date }[]>;
  delete(key: string): Promise<void>;
}

function newKey(ext: string, prefix = "") {
  const now = new Date();
  return `${prefix}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
}
const KEY_RE = /^[a-z0-9/_.-]{5,200}$/i;
function checkKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("invalid key");
}

const r2Storage: Storage = {
  async put(data, ext, opts = {}) {
    const key = opts.key ?? newKey(ext, opts.prefix);
    checkKey(key);
    await bucket().put(key, data, { httpMetadata: opts.contentType ? { contentType: opts.contentType } : undefined });
    return key;
  },
  async get(key) {
    checkKey(key);
    const o = await bucket().get(key);
    if (!o) throw new Error("not found");
    return new Uint8Array(await o.arrayBuffer());
  },
  async list(prefix) {
    const out: { key: string; size: number; uploaded: Date }[] = [];
    let cursor: string | undefined;
    do {
      const r = await bucket().list({ prefix, cursor, limit: 1000 });
      out.push(...r.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return out;
  },
  async delete(key) { checkKey(key); await bucket().delete(key); },
};
function bucket() {
  const b = cfEnv().FILES;
  if (!b) throw new Error("Binding R2 FILES belum dikonfigurasi");
  return b;
}

const root = async () => (await import("node:path")).resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
const localStorageAdapter: Storage = {
  async put(data, ext, opts = {}) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const key = opts.key ?? newKey(ext, opts.prefix);
    checkKey(key);
    const full = path.join(await root(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: opts.key ? "w" : "wx" });
    return key;
  },
  async get(key) {
    checkKey(key);
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    return new Uint8Array(await readFile(path.join(await root(), key)));
  },
  async list(prefix) {
    const { readdir, stat } = await import("node:fs/promises");
    const path = await import("node:path");
    const base = await root();
    const out: { key: string; size: number; uploaded: Date }[] = [];
    let entries: string[] = [];
    try { entries = (await readdir(path.join(base, prefix), { recursive: true })) as string[]; } catch { return out; }
    for (const e of entries) {
      const s = await stat(path.join(base, prefix, e));
      if (s.isFile()) out.push({ key: `${prefix}${e}`.replace(/\\/g, "/"), size: s.size, uploaded: s.mtime });
    }
    return out;
  },
  async delete(key) {
    checkKey(key);
    const { rm } = await import("node:fs/promises");
    const path = await import("node:path");
    await rm(path.join(await root(), key), { force: true });
  },
};

export function storage(): Storage {
  return isWorkers || process.env.STORAGE_DRIVER === "r2" ? r2Storage : localStorageAdapter;
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export const ALLOWED_TYPES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: "image/png", ext: "png", test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { mime: "image/heic", ext: "heic", test: (b) => ascii(b, 4, 8) === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(ascii(b, 8, 12)) },
  { mime: "application/pdf", ext: "pdf", test: (b) => ascii(b, 0, 5) === "%PDF-" },
];

/** Detect the real type from magic bytes (never trust the client-provided MIME). */
export function sniff(b: Uint8Array) {
  return ALLOWED_TYPES.find((t) => t.test(b)) ?? null;
}
export const maxUploadBytes = () => Number(process.env.UPLOAD_MAX_MB ?? 10) * 1024 * 1024;
