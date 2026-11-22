import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Local-disk storage adapter. Swap for an S3-compatible adapter by keeping this interface. */
export interface Storage {
  put(data: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
}

const root = () => path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");

export const localStorage: Storage = {
  async put(data, ext) {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    const full = path.join(root(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx" });
    return key;
  },
  async get(key) {
    if (!/^[\d]{4}\/[\d]{2}\/[0-9a-f-]{36}\.[a-z]{3,4}$/.test(key)) throw new Error("invalid key");
    return readFile(path.join(root(), key));
  },
};

export const ALLOWED_TYPES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "image/heic", ext: "heic", test: (b) => b.subarray(4, 8).toString() === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(b.subarray(8, 12).toString()) },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

/** Detect the real type from magic bytes (never trust the client-provided MIME). */
export function sniff(b: Buffer) {
  return ALLOWED_TYPES.find((t) => t.test(b)) ?? null;
}
export const maxUploadBytes = () => Number(process.env.UPLOAD_MAX_MB ?? 10) * 1024 * 1024;
