import { describe, it, expect } from "vitest";
import {
  conclusaoLeiga,
  correlacao,
  estratificar,
  perfilOndeVenceu,
  quintis,
  type Estrato,
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

  it("variância zero em x -> null (ambos os métodos)", () => {
    const xs = Array(40).fill(5);
    expect(correlacao(xs, XS40, "pearson")).toBeNull();
    expect(correlacao(xs, XS40, "spearman")).toBeNull();
  });

  it("variância zero em y -> null (ambos os métodos)", () => {
    const ys = Array(40).fill(7);
    expect(correlacao(XS40, ys, "pearson")).toBeNull();
    expect(correlacao(XS40, ys, "spearman")).toBeNull();
  });

  it("empates usam rank médio: xs=[1,2,2,3,4..39] dá spearman exato", () => {
    const xs = [1, 2, 2, 3];
    for (let v = 4; v <= 39; v++) xs.push(v);
    expect(xs).toHaveLength(40);
    const r = correlacao(xs, XS40, "spearman");
    expect(r).not.toBeNull();
    expect(r!.n).toBe(40);
    // Rank médio do par empatado = 2.5 (não min-rank 2): 0.99995309...,
    // distinto da alternativa min-rank (0.99991450...) na 5ª casa.
    expect(r!.r).toBeCloseTo(0.99995309, 6);
    expect(r!.r).toBeLessThan(1);
  });

  it("fronteira do piso: n=29 -> null, n=30 -> não-nulo", () => {
    const xs29 = Array.from({ length: 29 }, (_, i) => i + 1);
    const ys29 = xs29.map((x) => 2 * x);
    expect(correlacao(xs29, ys29, "pearson")).toBeNull();
    expect(correlacao(xs29, ys29, "spearman")).toBeNull();
    const xs30 = Array.from({ length: 30 }, (_, i) => i + 1);
    const ys30 = xs30.map((x) => 2 * x);
    const p = correlacao(xs30, ys30, "pearson");
    const s = correlacao(xs30, ys30, "spearman");
    expect(p).not.toBeNull();
    expect(s).not.toBeNull();
    expect(p!.n).toBe(30);
    expect(p!.r).toBeCloseTo(1, 10);
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

  it("supressão na fonte: n=20 -> [] (suprimido ≡ sem dados)", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const ys = xs.map((x) => 2 * x);
    expect(quintis(xs, ys)).toEqual([]);
  });

  it("supressão na fonte: entrada vazia -> []", () => {
    expect(quintis([], [])).toEqual([]);
  });

  it("n não-divisível (42): tamanhos [9,9,8,8,8], soma 42", () => {
    const xs = Array.from({ length: 42 }, (_, i) => i + 1);
    const ys = xs.map((x) => 2 * x);
    const qs = quintis(xs, ys);
    expect(qs).toHaveLength(5);
    expect(qs.map((q) => q.n)).toEqual([9, 9, 8, 8, 8]);
    expect(qs.reduce((acc, q) => acc + q.n, 0)).toBe(42);
  });
});

function demoCheia(over: Partial<Record<string, number | null>>): MunRow["demo"] {
  return {
    esc_sup: 10,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 5000,
    ...over,
  };
}

function munXY(ibge: string, uf: string, x: number, y: number): MunRow {
  return {
    ibge,
    uf,
    nome: "",
    votos: [0, 0],
    total: null,
    abst: null,
    demo: demoCheia({ esc_sup: x, renda_media: y }),
  };
}

describe("estratificar", () => {
  it("por regiao: efeito some num estrato (SE r=1, NE |r|<0.3, n exatos)", () => {
    const rows: MunRow[] = [];
    for (let i = 1; i <= 35; i++) rows.push(munXY(`sp${i}`, "SP", i, 2 * i));
    for (let i = 1; i <= 35; i++)
      rows.push(munXY(`ba${i}`, "BA", i, ((i * i * 7 + 3 * i + 1) % 13) - 6));
    const es = estratificar(rows, "esc_sup", "renda_media", "regiao");
    expect(es.map((e) => e.estrato)).toEqual(["NE", "SE"]);
    const [ne, se] = es;
    expect(ne.n).toBe(35);
    expect(ne.r).not.toBeNull();
    expect(Math.abs(ne.r!)).toBeLessThan(0.3);
    expect(se.n).toBe(35);
    expect(se.r).toBeCloseTo(1, 10);
  });

  it("por faixa_renda: tercis rotulados, n=[30,30,30], r=1 em cada", () => {
    const rows: MunRow[] = [];
    for (let i = 1; i <= 90; i++) rows.push(munXY(`m${i}`, "MG", i, 3 * i + 7));
    const es = estratificar(rows, "esc_sup", "renda_media", "faixa_renda");
    expect(es.map((e) => e.estrato)).toEqual(["baixa", "media", "alta"]);
    expect(es.map((e) => e.n)).toEqual([30, 30, 30]);
    for (const e of es) expect(e.r).toBeCloseTo(1, 10);
  });

  it("varY candidato: share linear -> r=1 exato no estrato", () => {
    const rows: MunRow[] = Array.from({ length: 30 }, (_, k) => {
      const x = k + 1;
      return {
        ibge: `s${x}`,
        uf: "SP",
        nome: "",
        votos: [x, 100 - x],
        total: null,
        abst: null,
        demo: demoCheia({ esc_sup: x }),
      } satisfies MunRow;
    });
    const es = estratificar(
      rows,
      "esc_sup",
      { candidatoId: "A", candidatos: CANDIDATOS },
      "regiao",
    );
    expect(es).toHaveLength(1);
    expect(es[0].estrato).toBe("SE");
    expect(es[0].n).toBe(30);
    expect(es[0].r).toBeCloseTo(1, 10);
  });

  it("piso herdado: estrato com n=10 -> r null", () => {
    const rows: MunRow[] = [];
    for (let i = 1; i <= 10; i++) rows.push(munXY(`r${i}`, "RJ", i, 2 * i));
    expect(estratificar(rows, "esc_sup", "renda_media", "regiao")).toEqual([
      { estrato: "SE", r: null, n: 10 },
    ]);
  });

  it("mapa UF->região cobre as 5 regiões", () => {
    const ufs: [string, string][] = [
      ["AC", "N"],
      ["AL", "NE"],
      ["DF", "CO"],
      ["ES", "SE"],
      ["PR", "S"],
    ];
    const rows = ufs.map(([uf], k) => munXY(`u${k}`, uf, k + 1, 2 * (k + 1)));
    const es = estratificar(rows, "esc_sup", "renda_media", "regiao");
    expect(es.map((e) => e.estrato).sort()).toEqual([
      "CO",
      "N",
      "NE",
      "S",
      "SE",
    ]);
    for (const [uf, regiao] of ufs) {
      void uf;
      expect(es.find((e) => e.estrato === regiao)).toBeDefined();
    }
  });
});

describe("conclusaoLeiga", () => {
  const E = (estrato: string, r: number | null, n: number): Estrato => ({
    estrato,
    r,
    n,
  });

  it("sustentado: sinal consistente e |r|>=0.3 na maioria dos n>=30", () => {
    expect(
      conclusaoLeiga(0.8, [E("SE", 0.9, 40), E("NE", 0.85, 40), E("S", 0.1, 40)]),
    ).toBe("sustentado");
  });

  it("misto: sinais opostos fortes entre estratos", () => {
    expect(conclusaoLeiga(0.1, [E("SE", 0.9, 40), E("NE", -0.8, 40)])).toBe(
      "misto",
    );
  });

  it("nao_sustentado: nenhum estrato com |r|>=0.3", () => {
    expect(
      conclusaoLeiga(0.1, [E("SE", 0.2, 40), E("NE", -0.1, 35), E("S", 0.05, 50)]),
    ).toBe("nao_sustentado");
  });

  it("nao_sustentado: forte mas minoria dos estratos (1 de 3)", () => {
    expect(
      conclusaoLeiga(0.9, [E("SE", 0.9, 40), E("NE", 0.1, 40), E("S", 0.05, 40)]),
    ).toBe("nao_sustentado");
  });

  it("misto: global forte contradiz estratos consistentes", () => {
    expect(conclusaoLeiga(-0.8, [E("SE", 0.9, 40), E("NE", 0.85, 40)])).toBe(
      "misto",
    );
  });

  it("nao_sustentado: tudo suprimido (r null / n<30)", () => {
    expect(conclusaoLeiga(null, [E("SE", null, 10)])).toBe("nao_sustentado");
  });
});
