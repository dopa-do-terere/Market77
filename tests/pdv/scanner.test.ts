import { describe, expect, it } from "vitest";
import { createScanner } from "@/pdv/scanner";

function type(feed: (k: string, t: number) => void, text: string, start = 0, gap = 10) {
  let t = start;
  for (const ch of text) feed(ch, (t += gap));
  return t;
}

describe("createScanner", () => {
  it("submits the accumulated code on Enter", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    const t = type(feed, "7891000100103", 0);
    feed("Enter", t + 10);
    expect(seen).toEqual(["7891000100103"]);
  });

  it("starts the next code from scratch", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    let t = type(feed, "AAAA", 0);
    feed("Enter", (t += 10));
    t = type(feed, "BBBB", t);
    feed("Enter", t + 10);
    expect(seen).toEqual(["AAAA", "BBBB"]);
  });

  it("ignores codes shorter than four characters and non-printable keys", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    let t = type(feed, "123", 0);
    feed("Enter", (t += 10));
    feed("Shift", (t += 10));
    feed("Tab", (t += 10));
    t = type(feed, "1234", t);
    feed("Enter", t + 10);
    expect(seen).toEqual(["1234"]);
  });

  it("drops stale characters when the gap between keys is too long", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c), 500);
    type(feed, "XXXX", 0);
    const t = type(feed, "9999", 5000);
    feed("Enter", t + 10);
    expect(seen).toEqual(["9999"]);
  });
});
