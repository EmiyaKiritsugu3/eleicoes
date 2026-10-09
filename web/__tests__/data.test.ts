import { describe, it, expect } from "vitest";
import { formatVotes } from "../lib/data";
describe("formatVotes", () => {
  it("formats 1234567 as 1.234.567", () => {
    expect(formatVotes(1234567)).toBe("1.234.567");
  });
});
describe("manifest guard", () => {
  it("flags missing hash as não auditado", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({})).toBe(false);
  });
});
describe("ledger rulings", () => {
  it("isAudited true com sha256 presente", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "abc123" })).toBe(true);
  });
  it("getAuditInfo null sem manifest (dado não auditado)", async () => {
    const { getAuditInfo } = await import("../lib/data");
    expect(getAuditInfo(null)).toBe(null);
    expect(getAuditInfo({ ingestions: [] })).toBe(null);
    expect(getAuditInfo({ ingestions: [{ source_url: "x" }] })).toBe(null);
  });
  it("getResumo vazio sinaliza sem dado oficial", async () => {
    const { getResumo } = await import("../lib/data");
    expect(getResumo([], {})).toEqual({ totalVotos: 0, vazio: true });
  });
  it("getResumo soma votos com filtros ano/cargo/uf", async () => {
    const { getResumo } = await import("../lib/data");
    const porUf = [
      { ano: 2022, cargo: "presidente", uf: "SP", votos: 100 },
      { ano: 2022, cargo: "presidente", uf: "RJ", votos: 50 },
      { ano: 2020, cargo: "prefeito", uf: "SP", votos: 30 },
    ];
    expect(getResumo(porUf, {}).totalVotos).toBe(180);
    expect(getResumo(porUf, { ano: "2022" }).totalVotos).toBe(150);
    expect(getResumo(porUf, { uf: "sp" }).totalVotos).toBe(130);
  });
});
