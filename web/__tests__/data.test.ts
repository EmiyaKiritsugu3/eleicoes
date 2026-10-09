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
describe("ledger rulings", () => {  it("isAudited true com sha256 presente", async () => {
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
describe("getSealState (selo único de /, /analisar e /auditoria)", () => {
  const FIXTURE_HASH =
    "879f5504a9918fde9b31045fe810285e8c285ce82a72693a2b4d6e2bc20af07a";
  const fixtureManifest = {
    ingestions: [
      { source_url: "https://cdn.tse.jus.br/x.zip", sha256: FIXTURE_HASH, fixture: true },
    ],
  };
  it("fixture-only: nunca oficial, hash cheio preservado p/ transparência", async () => {
    const { getSealState } = await import("../lib/data");
    const seal = getSealState(fixtureManifest);
    expect(seal.official).toBe(null);
    expect(seal.hasFixture).toBe(true);
    expect(seal.fixtureHash).toBe(FIXTURE_HASH);
  });
  it("manifest misto: oficial vence p/ o selo, fixture segue sinalizada", async () => {
    const { getSealState } = await import("../lib/data");
    const seal = getSealState({
      ingestions: [
        { source_url: "u", sha256: "f", fixture: true },
        { source_url: "u2", sha256: "abc", date: "2026-01-01" },
      ],
    });
    expect(seal.official).toEqual({ hash: "abc", url: "u2", date: "2026-01-01" });
    expect(seal.hasFixture).toBe(true);
    expect(seal.fixtureHash).toBe("f");
  });
  it("oficial-only: selo oficial, sem fixture", async () => {
    const { getSealState } = await import("../lib/data");
    const seal = getSealState({
      ingestions: [{ source_url: "u2", sha256: "abc", date: "2026-01-01" }],
    });
    expect(seal.official).toEqual({ hash: "abc", url: "u2", date: "2026-01-01" });
    expect(seal.hasFixture).toBe(false);
    expect(seal.fixtureHash).toBe("");
  });
  it("ausente/vazio/sem-hash: sem selo e sem fixture (fail-closed)", async () => {
    const { getSealState } = await import("../lib/data");
    for (const m of [null, {}, { ingestions: [] }, { ingestions: [{ source_url: "x" }] }]) {
      const seal = getSealState(m);
      expect(seal.official).toBe(null);
      expect(seal.hasFixture).toBe(false);
      expect(seal.fixtureHash).toBe("");
    }
  });
});
