export type Config = { serverUrl: string; token: string; browserCommand: string };

/** Parses /opt/market77/config.json. Plain http is accepted only for localhost (development). */
export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("config.json is not valid JSON");
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const serverUrl = typeof o.serverUrl === "string" ? o.serverUrl.replace(/\/+$/, "") : "";
  if (!/^https:\/\/[^\s]+$/.test(serverUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(serverUrl)) {
    throw new Error("serverUrl must be https (http only for localhost)");
  }
  const token = typeof o.token === "string" ? o.token : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("token is missing or malformed");
  const browserCommand =
    typeof o.browserCommand === "string" && o.browserCommand !== "" ? o.browserCommand : "chromium-browser";
  return { serverUrl, token, browserCommand };
}
