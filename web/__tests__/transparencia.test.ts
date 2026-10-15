import { describe, it, expect } from "vitest";
import { govSerie, isAnoEleitoral, type GovRow } from "../lib/data";

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
});
