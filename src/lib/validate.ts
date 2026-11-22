import type { z } from "zod";
import { ValidationError } from "./errors";

/** zod parse that throws a ValidationError with Indonesian, field-keyed messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.join(".") || "_";
    fields[k] ??= i.message;
  }
  throw new ValidationError(Object.entries(fields).map(([k, m]) => (k === "_" ? m : `${k}: ${m}`)).join("; "), fields);
}
