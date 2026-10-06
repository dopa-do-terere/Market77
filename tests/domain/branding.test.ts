import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { getBranding, logoDataUrl, MAX_LOGO_BYTES, saveBranding } from "@/domain/branding";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
import { GET } from "@/app/api/pdv/branding/route";
import { can } from "@/auth/permissions";
import { codeOf, makeOrg, resetDb, seedStore } from "../helpers";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const logo = logoDataUrl(png, "image/png");
beforeEach(resetDb);

describe("market identity", () => {
  it("saves the logo, keeps it on a name-only edit and explicitly removes it", async () => {
    const org = await makeOrg();
    await withOrg(org, async (tx) => {
      expect(await getBranding(tx)).toBeNull();
      await saveBranding(tx, org, " Aurora ", logo);
      expect(await getBranding(tx)).toEqual({ name: "Aurora", logoDataUrl: logo });
      await saveBranding(tx, org, "Aurora Express", undefined);
      expect((await getBranding(tx))?.logoDataUrl).toBe(logo);
      await saveBranding(tx, org, "Aurora Express", null);
      expect(await getBranding(tx)).toEqual({ name: "Aurora Express", logoDataUrl: null });
    });
  });
  it("isolates reads and rejects writes across organizations", async () => {
    const a = await makeOrg("A"), b = await makeOrg("B");
    await withOrg(a, (tx) => saveBranding(tx, a, "Aurora", logo));
    expect(await withOrg(b, getBranding)).toBeNull();
    await expect(withOrg(b, (tx) => saveBranding(tx, a, "Other", null))).rejects.toThrow();
    expect((await withOrg(a, getBranding))?.name).toBe("Aurora");
  });
  it("rejects unsupported content, spoofed MIME, oversized uploads and external URLs", async () => {
    expect(() => logoDataUrl(Buffer.from('<svg onload="alert(1)"/>'), "image/svg+xml")).toThrow();
    expect(() => logoDataUrl(Buffer.from("not an image"), "image/png")).toThrow();
    expect(() => logoDataUrl(png, "image/jpeg")).toThrow();
    expect(() => logoDataUrl(Buffer.alloc(MAX_LOGO_BYTES + 1), "image/png")).toThrow();
    const org = await makeOrg();
    expect(await codeOf(withOrg(org, (tx) => saveBranding(tx, org, "Aurora", "https://example.com/logo.svg")))).toBe("logo_format");
    expect(await codeOf(withOrg(org, (tx) => saveBranding(tx, org, " ", logo)))).toBe("invalid_input");
  });
  it("only lets the owner change the identity", () => {
    expect(can("owner", "branding:write")).toBe(true);
    expect(can("manager", "branding:write")).toBe(false);
    expect(can("restocker", "branding:write")).toBe(false);
  });
  it("returns only the authenticated terminal's identity and denies revoked tokens", async () => {
    const org = await makeOrg();
    const store = await seedStore(org);
    const terminal = await withOrg(org, (tx) => createTerminal(tx, org, { marketId: store.marketId, name: "Totem" }));
    const req = (token?: string) => new Request("http://m77.test/api/pdv/branding", { headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect((await GET(req())).status).toBe(401);
    expect(await (await GET(req(terminal.token))).json()).toEqual({ branding: null });
    await withOrg(org, (tx) => saveBranding(tx, org, "Aurora", logo));
    expect(await (await GET(req(terminal.token))).json()).toEqual({ branding: { name: "Aurora", logoDataUrl: logo } });
    const other = await makeOrg();
    const otherStore = await seedStore(other);
    const otherTerminal = await withOrg(other, (tx) => createTerminal(tx, other, {marketId: otherStore.marketId, name: "Outro"}));
    expect(await (await GET(req(otherTerminal.token))).json()).toEqual({ branding: null });
    await withOrg(org, (tx) => revokeTerminal(tx, terminal.id));
    expect((await GET(req(terminal.token))).status).toBe(401);
  });
});
