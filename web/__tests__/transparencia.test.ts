import { describe, it, expect } from "vitest";
import {
  formatBRL,
  getSealParaArquivo,
  govSerie,
  isAnoEleitoral,
  serieComLacunas,
  type GovRow,
} from "../lib/data";

describe("transparencia", () => {
  it("marca anos eleitorais e pula ano sem dado", () => {
    expect(isAnoEleitoral(2022)).toBe(true);
    expect(isAnoEleitoral(2021)).toBe(false);
    expect(
      govSerie([{ ano: 2021, ente_id: "UNIAO", despesa_empenhada: 10 } as GovRow], {}),
    ).toHaveLength(1);
    expect(govSerie([], {})).toEqual([]);
  });
  it("ordena por ano e pula valor não-finito sem somar 0", () => {
    const rows = [
      { ano: 2022, ente_id: "UNIAO", despesa_empenhada: 20 },
      { ano: 2020, ente_id: "UNIAO", despesa_empenhada: 10 },
      { ano: 2021, ente_id: "UNIAO", despesa_empenhada: NaN },
    ] as GovRow[];
    const serie = govSerie(rows, {});
    expect(serie.map((r) => r.ano)).toEqual([2020, 2022]);
    expect(serie.find((r) => r.ano === 2022)).toEqual({
      ano: 2022,
      valor: 20,
      eleitoral: true,
    });
    expect(serie.find((r) => r.ano === 2020)?.eleitoral).toBe(true);
  });
  it("filtra por ente_id e cobre todos os anos eleitorais", () => {
    for (const ano of [2014, 2016, 2018, 2020, 2022, 2024])
      expect(isAnoEleitoral(ano)).toBe(true);
    expect(isAnoEleitoral(2015)).toBe(false);
    const rows = [
      { ano: 2022, ente_id: "UNIAO", despesa_empenhada: 20 },
      { ano: 2022, ente_id: "SP", despesa_empenhada: 5 },
    ] as GovRow[];
    expect(govSerie(rows, { ente_id: "SP" })).toEqual([
      { ano: 2022, valor: 5, eleitoral: true },
    ]);
  });
  it("completa a janela 2014-2024 com lacunas, nunca 0", () => {
    const lacunas = serieComLacunas(govSerie([], {}));
    expect(lacunas).toHaveLength(11);
    expect(lacunas.every((r) => r.valor === null)).toBe(true);
    const parcial = serieComLacunas(
      govSerie(
        [
          { ano: 2022, ente_id: "UNIAO", despesa_empenhada: 20 },
          { ano: 2020, ente_id: "UNIAO", despesa_empenhada: 10 },
        ] as GovRow[],
        {},
      ),
    );
    expect(parcial.find((r) => r.ano === 2022)?.valor).toBe(20);
    expect(parcial.find((r) => r.ano === 2021)?.valor).toBeNull();
    expect(parcial.find((r) => r.ano === 2021)?.eleitoral).toBe(false);
    expect(parcial.find((r) => r.ano === 2020)?.eleitoral).toBe(true);
  });
  it("formata BRL pt-BR e nega não-finito", () => {
    expect(formatBRL(2000.5)).toContain("R$");
    expect(formatBRL(2000.5)).toContain("2.000,50");
    expect(formatBRL(NaN)).toBe("sem dado oficial");
  });
  it("selo ligado ao arquivo gov_serie.json, nunca à 1ª ingestão", () => {
    const manifest = {
      ingestions: [
        {
          source_url: "https://tse.oficial/votos",
          sha256: "a".repeat(64),
          data: "2024-01-01",
          dataset: "votos",
        },
      ],
      artifacts: [
        {
          source_url: "https://tse.oficial/votos",
          sha256: "a".repeat(64),
          data: "2024-01-01",
          dataset: "votos",
          arquivo: "resumo.json",
          size_bytes: 10,
        },
        {
          source_url: "https://tesouro/gov",
          sha256: "b".repeat(64),
          data: "2024-01-01",
          dataset: "siconfi",
          arquivo: "gov_serie.json",
          size_bytes: 10,
          fixture: true,
        },
      ],
    };
    // Artefato gov é fixture → selo fixture, mesmo com ingestão oficial de votos.
    const selo = getSealParaArquivo(manifest, "gov_serie.json");
    expect(selo.official).toBeNull();
    expect(selo.hasFixture).toBe(true);
    expect(selo.fixtureHash).toBe("b".repeat(64));
    // Arquivo sem registro → selo vazio (fail-closed).
    const vazio = getSealParaArquivo(manifest, "inexistente.json");
    expect(vazio).toEqual({ official: null, hasFixture: false, fixtureHash: "" });
    // Artefato oficial não-fixture → selo oficial do próprio arquivo.
    const manifestOk = {
      artifacts: [
        {
          source_url: "https://tesouro/gov",
          sha256: "c".repeat(64),
          data: "2024-01-01",
          dataset: "siconfi",
          arquivo: "gov_serie.json",
          size_bytes: 10,
        },
      ],
    };
    expect(getSealParaArquivo(manifestOk, "gov_serie.json").official?.hash).toBe(
      "c".repeat(64),
    );
  });
});
