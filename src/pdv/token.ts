const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** The agent opens /pdv#token=...; a fragment never reaches the server. Returns null for anything that is not a plausible token. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token !== null && TOKEN_RE.test(token) ? token : null;
}
