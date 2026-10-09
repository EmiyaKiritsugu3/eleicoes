import { describe, it, expect } from "vitest";
import { formatVotes, type PorCandidatoRow, type PorUfRow } from "../lib/data";
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
  it("audited trim: hash só-espaços é falso (F5)", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "   " })).toBe(false);
    expect(isAudited({ hash: "  \t " })).toBe(false);
  });
  it("official display ignora chaves extras desconhecidas (M14)", async () => {
    const { isOfficialDisplay } = await import("../lib/data");
    expect(isOfficialDisplay({ sha256: "x".repeat(64), outraChave: 1 })).toBe(true);
  });
  it("getOfficialAuditInfo null sem manifest (dado não auditado)", async () => {
    const { getOfficialAuditInfo } = await import("../lib/data");
    expect(getOfficialAuditInfo(null)).toBe(null);
    expect(getOfficialAuditInfo({ ingestions: [] })).toBe(null);
    expect(getOfficialAuditInfo({ ingestions: [{ source_url: "x" }] })).toBe(null);
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
describe("evolucaoAnual respeita filtro ano (F3)", () => {
  it("só 2022 quando ano=2022", async () => {
    const { evolucaoAnual } = await import("../lib/data");
    const porUf: PorUfRow[] = [
      { ano: 2022, cargo: "presidente", uf: "SP", votos: 100 },
      { ano: 2018, cargo: "presidente", uf: "SP", votos: 40 },
    ];
    expect(evolucaoAnual(porUf, { ano: "2022" })).toEqual([
      { ano: 2022, votos: 100 },
    ]);
  });
});

describe("votos não-finito excluído das somas (M12-finito)", () => {
  it("getResumo: linha corrupta não sustenta seção", async () => {
    const { getResumo } = await import("../lib/data");
    expect(
      getResumo([{ votos: null } as unknown as PorUfRow], {}),
    ).toEqual({ totalVotos: 0, vazio: true });
  });
  it("rankingUf pula votos não-finitos", async () => {
    const { rankingUf } = await import("../lib/data");
    const porUf = [
      { ano: 2022, cargo: "presidente", uf: "SP", votos: 100 },
      { ano: 2022, cargo: "presidente", uf: "RJ", votos: NaN },
    ] as unknown as PorUfRow[];
    expect(rankingUf(porUf, {})).toEqual([{ uf: "SP", votos: 100 }]);
  });
  it("evolucaoAnual pula votos não-finitos", async () => {
    const { evolucaoAnual } = await import("../lib/data");
    const porUf = [
      { ano: 2022, cargo: "presidente", uf: "SP", votos: 100 },
      { ano: 2022, cargo: "presidente", uf: "RJ", votos: Infinity },
    ] as unknown as PorUfRow[];
    expect(evolucaoAnual(porUf, {})).toEqual([{ ano: 2022, votos: 100 }]);
  });
  it("filtrarCandidatos pula votos não-finitos", async () => {
    const { filtrarCandidatos } = await import("../lib/data");
    const rows = [
      { candidato_id: "a", nome_urna: "ANA", partido: "PT", votos: 100 },
      { candidato_id: "b", nome_urna: "BETO", partido: "PT", votos: null },
    ] as unknown as PorCandidatoRow[];
    expect(filtrarCandidatos(rows, {})).toEqual([rows[0]]);
  });
});

describe("resolverComparador deriva de cands + null sob semCob (F4)", () => {
  const candA = { candidato_id: "a", nome_urna: "ANA", partido: "PT", votos: 100 };
  it("id fora de cands (filtrado) resolve null", async () => {
    const { resolverComparador } = await import("../lib/data");
    const sides = resolverComparador({
      compMode: "candidatos",
      compA: "a",
      compB: "b",
      ev: [],
      cands: [candA],
      semCob: false,
    });
    expect(sides.left).toEqual({ titulo: "ANA", votos: 100, detalhe: "PT" });
    expect(sides.right).toBe(null);
  });
  it("semCob zera os dois lados", async () => {
    const { resolverComparador } = await import("../lib/data");
    const sides = resolverComparador({
      compMode: "candidatos",
      compA: "a",
      compB: "a",
      ev: [{ ano: 2022, votos: 100 }],
      cands: [candA],
      semCob: true,
    });
    expect(sides).toEqual({ left: null, right: null });
  });
  it("anos resolve da série filtrada", async () => {
    const { resolverComparador } = await import("../lib/data");
    const sides = resolverComparador({
      compMode: "anos",
      compA: "2022",
      compB: "2018",
      ev: [{ ano: 2022, votos: 100 }],
      cands: [],
      semCob: false,
    });
    expect(sides.left).toEqual({ titulo: "2022", votos: 100, detalhe: "ano" });
    expect(sides.right).toBe(null);
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
