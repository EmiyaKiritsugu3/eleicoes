import { describe, it, expect } from "vitest";
import {
  perfilOndeVenceu,
  type MunRow,
} from "../lib/motor";

const CANDIDATOS = [
  { id: "A", nome: "Cand A", partido: "PA" },
  { id: "B", nome: "Cand B", partido: "PB" },
];

function mun(
  ibge: string,
  votos: (number | null)[],
  demo: MunRow["demo"],
): MunRow {
  return { ibge, uf: "SP", nome: "", votos, total: null, abst: null, demo };
}

function demo(eleitores: number, escSup: number) {
  return {
    esc_sup: escSup,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores,
  };
}

describe("perfilOndeVenceu", () => {
  it("nMun 2 onde A vence, média ponderada por eleitores e vsBrasil exatos", () => {
    const rows = [
      mun("1", [100, 40], demo(1000, 10)), // vence A
      mun("2", [60, 50], demo(3000, 20)), // vence A
      mun("3", [30, 200], demo(5000, 30)), // vence B
    ];
    const r = perfilOndeVenceu(rows, { candidatoId: "A", candidatos: CANDIDATOS });
    expect(r.nMun).toBe(2);
    expect(r.nEleitores).toBe(4000);
    // (10*1000 + 20*3000) / 4000 = 17.5
    expect(r.medias.esc_sup).toBeCloseTo(17.5, 10);
    // (10*1000 + 20*3000 + 30*5000) / 9000 = 24.444...
    expect(r.vsBrasil.esc_sup).toBeCloseTo(220000 / 9000, 10);
    expect(r.vsBrasil.pop).toBeCloseTo(10000, 10);
  });

  it("demo null excluída: nEleitores só dos válidos", () => {
    const rows = [
      mun("1", [100, 40], demo(1000, 10)), // vence A, válido
      mun("2", [60, 50], null), // vence A, demo null -> excluído
      mun("3", [30, 200], demo(5000, 30)), // vence B
    ];
    const r = perfilOndeVenceu(rows, { candidatoId: "A", candidatos: CANDIDATOS });
    expect(r.nMun).toBe(1);
    expect(r.nEleitores).toBe(1000);
    expect(r.medias.esc_sup).toBeCloseTo(10, 10);
    // baseline nacional só sobre válidos: (10*1000 + 30*5000) / 6000
    expect(r.vsBrasil.esc_sup).toBeCloseTo(160000 / 6000, 10);
  });

  it("candidatoId desconhecido: perfil vazio, baseline mantido", () => {
    const rows = [mun("1", [100, 40], demo(1000, 10))];
    const r = perfilOndeVenceu(rows, { candidatoId: "ZZ", candidatos: CANDIDATOS });
    expect(r.nMun).toBe(0);
    expect(r.nEleitores).toBe(0);
    expect(Number.isNaN(r.medias.esc_sup)).toBe(true);
    expect(r.vsBrasil.esc_sup).toBeCloseTo(10, 10);
  });

  it("pesoFonte eleitores quando todas as vencedoras usam demo.eleitores", () => {
    const rows = [
      mun("1", [100, 40], demo(1000, 10)), // vence A
      mun("2", [60, 50], demo(3000, 20)), // vence A
      mun("3", [30, 200], demo(5000, 30)), // vence B
    ];
    const r = perfilOndeVenceu(rows, { candidatoId: "A", candidatos: CANDIDATOS });
    expect(r.pesoFonte).toBe("eleitores");
  });

  it("pesoFonte misto quando vencedora cai no fallback total (médias seguem computadas)", () => {
    const semEleitores = { ...demo(0, 20), eleitores: null };
    const rows: MunRow[] = [
      mun("1", [100, 40], demo(1000, 10)), // vence A, peso eleitores
      { ibge: "2", uf: "SP", nome: "", votos: [60, 50], total: 2000, abst: null, demo: semEleitores }, // vence A, fallback total
      mun("3", [30, 200], demo(5000, 30)), // vence B
    ];
    const r = perfilOndeVenceu(rows, { candidatoId: "A", candidatos: CANDIDATOS });
    expect(r.pesoFonte).toBe("misto");
    // nEleitores = soma dos pesos efetivos: 1000 + 2000 (fallback)
    expect(r.nEleitores).toBe(3000);
    // (10*1000 + 20*2000) / 3000 = 16.666...
    expect(r.medias.esc_sup).toBeCloseTo(50000 / 3000, 10);
  });
});
