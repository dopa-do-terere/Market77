import { describe, expect, it } from "vitest";
import { tokenFromHash } from "@/pdv/token";

const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";

describe("tokenFromHash", () => {
  it("reads a base64url token from the fragment, with or without the leading #", () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#x=1&token=${TOKEN}&y=2`)).toBe(TOKEN);
  });

  it("ignores a missing, empty, short or malformed token", () => {
    for (const h of ["", "#", "#token=", "#token=abc", `#token=${TOKEN}<script>`, "#other=1", `#token=${"a".repeat(101)}`]) {
      expect(tokenFromHash(h)).toBeNull();
    }
  });
});
