import { buildAgentTarball } from "./agent-package";

const [version, server] = process.argv.slice(2);

async function main() {
  const secret = process.env.RELEASE_SECRET;
  if (!version || !server || !secret) {
    console.error("usage: npm run agent:release -- <version> <server-url>   (RELEASE_SECRET comes from .env)");
    process.exit(1);
  }
  const body = await buildAgentTarball(version);
  const res = await fetch(`${server.replace(/\/+$/, "")}/api/internal/releases`, {
    method: "POST",
    headers: { "x-release-secret": secret, "x-version": version, "content-type": "application/gzip" },
    body: new Uint8Array(body),
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
}
main();
