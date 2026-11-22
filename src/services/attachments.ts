import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { attachments } from "@/db/schema";
import { type Actor, assertPropertyAccess, requirePermission } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";
import { storage, sniff, maxUploadBytes, type Storage } from "@/lib/storage";

/**
 * Per-entity access policy for attachments. Each module registers how to check
 * read / write access to its records. Unknown entity types are denied.
 */
type Policy = { read: (tx: Tx, a: Actor, id: string) => Promise<void>; write: (tx: Tx, a: Actor, id: string) => Promise<void> };
export const ATTACHMENT_POLICIES: Record<string, Policy> = {
  property: {
    read: (tx, a, id) => assertPropertyAccess(tx, a, "property.view", id),
    write: async (_tx, a) => { requirePermission(a, "property.manage"); },
  },
};

export type UploadFile = { name: string; data: Uint8Array };

export async function addAttachments(tx: Tx, actor: Actor, entityType: string, entityId: string, files: UploadFile[], kind = "photo", store: Storage = storage()) {
  const policy = ATTACHMENT_POLICIES[entityType];
  if (!policy) throw new ForbiddenError();
  await policy.write(tx, actor, entityId);
  if (!files.length) throw new ValidationError("Tidak ada file yang dipilih.");
  if (files.length > 10) throw new ValidationError("Maksimal 10 file sekaligus.");
  const out = [];
  for (const f of files) {
    if (f.data.length === 0) throw new ValidationError(`File ${f.name} kosong.`);
    if (f.data.length > maxUploadBytes()) throw new ValidationError(`File ${f.name} melebihi batas ${process.env.UPLOAD_MAX_MB ?? 10} MB.`);
    const t = sniff(f.data);
    if (!t) throw new ValidationError(`Tipe file ${f.name} tidak didukung (JPG, PNG, WEBP, HEIC, PDF).`);
    const key = await store.put(f.data, t.ext, { prefix: "attachments/", contentType: t.mime });
    const [row] = await tx.insert(attachments).values({
      entityType, entityId, kind, storageKey: key, originalName: f.name.slice(0, 200), mime: t.mime, sizeBytes: f.data.length, uploadedBy: actor.id,
    }).returning();
    out.push(row);
  }
  await audit(tx, actor, { action: "attachment.added", entityType, entityId, after: { files: out.map((o) => ({ id: o.id, name: o.originalName, mime: o.mime })) } });
  return out;
}

export async function readAttachment(tx: Tx, actor: Actor, id: string, store: Storage = storage()) {
  const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  if (!a) throw new NotFoundError();
  const policy = ATTACHMENT_POLICIES[a.entityType];
  if (!policy) throw new ForbiddenError();
  await policy.read(tx, actor, a.entityId);
  return { meta: a, data: await store.get(a.storageKey) };
}

/** Soft-remove (file kept for audit). */
export async function removeAttachment(tx: Tx, actor: Actor, id: string) {
  const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  if (!a) throw new NotFoundError();
  const policy = ATTACHMENT_POLICIES[a.entityType];
  if (!policy) throw new ForbiddenError();
  await policy.write(tx, actor, a.entityId);
  await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
  await audit(tx, actor, { action: "attachment.removed", entityType: a.entityType, entityId: a.entityId, before: { id, name: a.originalName } });
}
