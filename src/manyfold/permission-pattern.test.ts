import { describe, expect, it } from "vitest";
import { manyfoldOriginPattern } from "./permission-pattern";

describe("manyfoldOriginPattern", () => {
  it("keeps the port on Chrome", () => {
    expect(
      manyfoldOriginPattern("http://127.0.0.1:3215/some/path", false),
    ).toBe("http://127.0.0.1:3215/*");
  });

  it("drops the port on Firefox", () => {
    expect(manyfoldOriginPattern("http://127.0.0.1:3215/some/path", true)).toBe(
      "http://127.0.0.1/*",
    );
  });

  it("is the same for both when there is no port", () => {
    expect(manyfoldOriginPattern("https://manyfold.example.com", true)).toBe(
      "https://manyfold.example.com/*",
    );
    expect(manyfoldOriginPattern("https://manyfold.example.com", false)).toBe(
      "https://manyfold.example.com/*",
    );
  });

  it("keeps the brackets of an IPv6 host", () => {
    expect(manyfoldOriginPattern("http://[::1]:3214", true)).toBe(
      "http://[::1]/*",
    );
  });

  it("accepts an origin as well as a base URL", () => {
    expect(manyfoldOriginPattern("http://127.0.0.1:3215", true)).toBe(
      "http://127.0.0.1/*",
    );
  });

  it("throws on an unparsable URL", () => {
    expect(() => manyfoldOriginPattern("not a url", true)).toThrow();
    expect(() => manyfoldOriginPattern("not a url", false)).toThrow();
  });

  it("behaves as Chrome under vitest (no WXT define)", () => {
    expect(import.meta.env.FIREFOX).toBeFalsy();
  });
});
