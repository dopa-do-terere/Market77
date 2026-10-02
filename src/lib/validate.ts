import type { z } from "zod";
import { AppError } from "./errors";

export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("invalid_input", r.error.issues[0]?.message);
  return r.data;
}

/** FormData to plain object; blank fields are dropped so optional zod fields work. */
export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}
