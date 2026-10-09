import { describe, it, expect } from "vitest";
import { buildShareUrl, emptyStateFor } from "../lib/export";
describe("buildShareUrl", () => {
  it("embeds manifest hash", () => {
    expect(buildShareUrl({ ano: 2022 }, "abc123")).toContain("abc123");
  });
  it("empty filter returns sem dado oficial state", () => {
    expect(emptyStateFor([])).toMatch(/sem dado oficial/i);
  });
});
