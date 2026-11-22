import { getCloudflareContext } from "@opennextjs/cloudflare";

/** True when running inside Cloudflare Workers (production), false under Node (dev, tests, scripts). */
export const isWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** Minimal R2 binding surface used by COMS (avoids pulling the full workers-types into the DOM lib). */
export interface R2ObjectLike { key: string; size: number; uploaded: Date; arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream }
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string | string[]): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}

export type ComsEnv = {
  HYPERDRIVE?: { connectionString: string };
  FILES?: R2BucketLike;
  CRON_SECRET?: string;
};

export function cfEnv(): ComsEnv {
  return getCloudflareContext().env as unknown as ComsEnv;
}
/** Per-request execution context (used as a cache key for per-request resources). */
export function cfCtx(): object {
  return getCloudflareContext().ctx as unknown as object;
}
