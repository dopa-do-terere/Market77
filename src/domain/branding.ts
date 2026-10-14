import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";

export type Branding = { name: string; logoDataUrl: string | null };
export const MAX_LOGO_BYTES = 512 * 1024;

/** Only raster images; never store a user-supplied URL or active SVG content. */
export function logoDataUrl(bytes: Uint8Array, mime: string): string {
  const b = Buffer.from(bytes);
  if (!b.length || b.length > MAX_LOGO_BYTES) throw new AppError("logo_size");
  const valid = mime === "image/png" ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : mime === "image/webp" ? b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
    : false;
  if (!valid) throw new AppError("logo_format");
  return `data:${mime};base64,${b.toString("base64")}`;
}

export async function getBranding(tx: Tx): Promise<Branding | null> {
  const [row] = await tx`select name, logo_data_url from organization_branding`;
  return row ? { name: row.name as string, logoDataUrl: row.logo_data_url as string | null } : null;
}

export async function saveBranding(tx: Tx, orgId: string, name: unknown, logo: string | null | undefined): Promise<void> {
  const input = parse(z.object({ name: z.string().trim().min(2).max(100) }), { name });
  if (logo != null) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
    if (!match || logoDataUrl(Buffer.from(match[2], "base64"), match[1]) !== logo) throw new AppError("logo_format");
  }
  await tx`
    insert into organization_branding (org_id, name, logo_data_url) values (${orgId}, ${input.name}, ${logo ?? null})
    on conflict (org_id) do update set name = excluded.name,
      logo_data_url = case when ${logo !== undefined} then excluded.logo_data_url else organization_branding.logo_data_url end`;
}
