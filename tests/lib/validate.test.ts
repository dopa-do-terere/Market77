import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { formToObject, parse } from "@/lib/validate";

describe("parse", () => {
  it("returns the parsed output", () => {
    expect(parse(z.object({ n: z.coerce.number() }), { n: "3" })).toEqual({ n: 3 });
  });

  it("throws AppError invalid_input", () => {
    let err: unknown;
    try {
      parse(z.object({ n: z.number() }), { n: "x" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("invalid_input");
  });
});

describe("formToObject", () => {
  it("keeps non-empty string fields and drops blanks and files", () => {
    const fd = new FormData();
    fd.set("name", " Ana ");
    fd.set("address", "   ");
    fd.set("file", new Blob(["x"]), "x.txt");
    expect(formToObject(fd)).toEqual({ name: " Ana " });
  });
});
