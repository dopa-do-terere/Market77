import { describe, expect, it } from "vitest";
import { parseConfig } from "../../agent/config.ts";

const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";
const good = (o: object = {}) => JSON.stringify({ serverUrl: "https://m77.example.com/", token: TOKEN, ...o });

describe("parseConfig", () => {
  it("reads the server and token, trims the trailing slash and defaults the browser", () => {
    expect(parseConfig(good())).toEqual({
      serverUrl: "https://m77.example.com",
      token: TOKEN,
      browserCommand: "chromium-browser",
    });
    expect(parseConfig(good({ browserCommand: "google-chrome" })).browserCommand).toBe("google-chrome");
  });

  it("allows plain http only for localhost", () => {
    expect(parseConfig(good({ serverUrl: "http://localhost:3457" })).serverUrl).toBe("http://localhost:3457");
    expect(() => parseConfig(good({ serverUrl: "http://m77.example.com" }))).toThrow(/serverUrl/);
    expect(() => parseConfig(good({ serverUrl: "ftp://x" }))).toThrow(/serverUrl/);
  });

  it("rejects broken JSON and a missing or malformed token", () => {
    expect(() => parseConfig("{")).toThrow(/JSON/);
    expect(() => parseConfig(good({ token: "short" }))).toThrow(/token/);
    expect(() => parseConfig(JSON.stringify({ serverUrl: "https://x.com" }))).toThrow(/token/);
    expect(() => parseConfig("null")).toThrow(/serverUrl/);
  });
});
