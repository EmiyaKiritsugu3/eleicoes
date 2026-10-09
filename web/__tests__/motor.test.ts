import { describe, it, expect } from "vitest";
import {
  correlacao,
  perfilOndeVenceu,
  quintis,
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

const XS40 = Array.from({ length: 40 }, (_, i) => i + 1);

describe("correlacao", () => {
  it("r≈1 em relação linear perfeita n=40 (pearson)", () => {
    const ys = XS40.map((x) => 2 * x + 5);
    const r = correlacao(XS40, ys, "pearson");
    expect(r).not.toBeNull();
    expect(r!.n).toBe(40);
    expect(r!.r).toBeCloseTo(1, 10);
  });

  it("r≈1 monotônica não-linear n=40 (spearman captura x²)", () => {
    const ys = XS40.map((x) => x * x);
    const r = correlacao(XS40, ys, "spearman");
    expect(r).not.toBeNull();
    expect(r!.n).toBe(40);
    expect(r!.r).toBeCloseTo(1, 10);
  });

  it("r≈0 em dados sem relação n=40 (ambos os métodos)", () => {
    const ys = XS40.map((_, i) => ((i * i * 7 + 3 * i + 1) % 13) - 6);
    for (const metodo of ["pearson", "spearman"] as const) {
      const r = correlacao(XS40, ys, metodo);
      expect(r).not.toBeNull();
      expect(r!.n).toBe(40);
      expect(Math.abs(r!.r)).toBeLessThan(0.3);
    }
  });

  it("n_below_floor_suppressed: 20 pontos perfeitos -> null", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const ys = xs.map((x) => 2 * x);
    expect(correlacao(xs, ys, "pearson")).toBeNull();
    expect(correlacao(xs, ys, "spearman")).toBeNull();
  });

  it("pares com NaN excluídos antes de contar n", () => {
    const xs = [...XS40, NaN, NaN, NaN, NaN, NaN];
    const ys = [...XS40.map((x) => 2 * x), NaN, NaN, NaN, NaN, NaN];
    const r = correlacao(xs, ys, "pearson");
    expect(r).not.toBeNull();
    expect(r!.n).toBe(40);
    expect(r!.r).toBeCloseTo(1, 10);
  });

  it("válidos abaixo do piso após exclusão -> null", () => {
    const xs = [...XS40.slice(0, 25), ...Array(15).fill(NaN)];
    const ys = [...XS40.slice(0, 25).map((x) => 2 * x), ...Array(15).fill(NaN)];
    expect(correlacao(xs, ys, "pearson")).toBeNull();
  });

  it("outlier_reports_both_r: outlier inverte pearson, spearman resiste", () => {
    const ys = XS40.map((x) => x);
    ys[0] = 400; // outlier: menor x com y extremo
    const p = correlacao(XS40, ys, "pearson");
    const s = correlacao(XS40, ys, "spearman");
    expect(p).not.toBeNull();
    expect(s).not.toBeNull();
    expect(p!.n).toBe(40);
    expect(s!.n).toBe(40);
    expect(p!.r).toBeLessThan(0.2);
    expect(s!.r).toBeGreaterThan(0.8);
  });
});

describe("quintis", () => {
  it("divide em 5 faixas com n somando o total e médias crescentes", () => {
    const ys = XS40.map((x) => 2 * x);
    const qs = quintis(XS40, ys);
    expect(qs).toHaveLength(5);
    expect(qs.reduce((acc, q) => acc + q.n, 0)).toBe(40);
    expect(qs.map((q) => q.n)).toEqual([8, 8, 8, 8, 8]);
    expect(qs[0].mediaY).toBeCloseTo(9, 10);
    expect(qs[4].mediaY).toBeCloseTo(73, 10);
    for (let i = 1; i < 5; i++) {
      expect(qs[i].mediaY).toBeGreaterThan(qs[i - 1].mediaY);
    }
  });
});
