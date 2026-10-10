import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import checksJson from "../data/checks.json";
import {
  VerificarConteudo,
  verificarAfirmacao,
  checksParaRegiao,
  type Check,
  type TipoComputacao,
} from "../app/verificar/Verificar";
import type { SealState } from "../lib/data";
import type { MunRow } from "../lib/motor";

// Fato sintético: 40 municípios, cand-a vence todos; share de cand-a tem
// leve inclinação positiva com esc_sup (r ≈ 0,12 — sinal certo, efeito
// fraco). Nenhum fato real é lido aqui (funções puras sobre MunRow).
const CANDIDATOS = [
  { id: "cand-a", nome: "Candidata Exemplo A", partido: "PA" },
  { id: "cand-b", nome: "Candidato Exemplo B", partido: "PB" },
];

type FatoSintetico = {
  candidatos: typeof CANDIDATOS;
  municipios: MunRow[];
} | null;

function demo(over: Partial<Record<string, number>> = {}) {
  return {
    esc_sup: 10,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 1000,
    ...over,
  };
}

function linhas40(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const share = 0.55 + 0.0002 * i + (i % 2 ? 0.03 : -0.03);
    const a = Math.round(share * 1000);
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Município ${i}`,
      votos: [a, 1000 - a],
      total: 1000,
      abst: 150,
      demo: demo({ esc_sup: 5 + i * 0.5, renda_media: 1500 + i * 50 }),
    });
  }
  return rows;
}

function fato40(): FatoSintetico {
  return { candidatos: CANDIDATOS, municipios: linhas40() };
}

const SEAL_OK: SealState = {
  official: {
    hash: "d".repeat(64),
    url: "https://exemplo.tse.jus.br/fato.json",
    date: "2026-01-01",
  },
  hasFixture: false,
  fixtureHash: "",
};

const FONTES = ["https://dadosabertos.tse.jus.br/"];

// 3 checks sintéticos → 1 veredito de cada cor (spec §4: veredito tricolor).
const CHECK_SUSTENTADO: Check = {
  slug: "sint-vencedor",
  frase: "Candidata Exemplo A venceu no Brasil",
  computacao: { tipo: "vencedor_regiao", params: { quem: "@vencedor", regiao: "BR" } },
  fontes: FONTES,
};

const CHECK_ENGANOSO: Check = {
  slug: "sint-correlacao-fraca",
  frase: "Lugares mais escolarizados votaram mais em A",
  computacao: {
    tipo: "correlacao_sinal",
    params: { quem: "cand-a", variavel: "esc_sup", sinal: "positivo" },
  },
  fontes: FONTES,
};

const CHECK_FALSO: Check = {
  slug: "sint-media-errada",
  frase: "A venceu em lugares mais ricos",
  computacao: {
    tipo: "comparar_medias",
    params: { quem: "cand-a", variavel: "renda_media", direcao: "maior" },
  },
  fontes: FONTES,
};

function htmlDe(check: Check | null, slug: string, fato: FatoSintetico): string {
  return renderToStaticMarkup(
    React.createElement(VerificarConteudo, {
      check,
      slug,
      checks: checksJson as unknown as Check[],
      fato,
      seal: SEAL_OK,
      manifestChecked: true,
    }),
  );
}

describe("verificar (checks.json: 12 entradas, shape exato)", () => {
  it("12 entradas, slugs únicos, shape {slug, frase, computacao, fontes}", () => {
    const checks = checksJson as unknown as Check[];
    expect(checks).toHaveLength(12);
    const slugs = checks.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(12);
    const tipos: Set<TipoComputacao> = new Set([
      "vencedor_regiao",
      "comparar_medias",
      "correlacao_sinal",
      "serie_temporal",
      "soma_condicional",
    ]);
    for (const c of checks) {
      expect(typeof c.slug).toBe("string");
      expect(c.slug.length).toBeGreaterThan(0);
      expect(typeof c.frase).toBe("string");
      expect(c.frase.length).toBeGreaterThan(10);
      expect(tipos.has(c.computacao.tipo)).toBe(true);
      expect(typeof c.computacao.params).toBe("object");
      expect(Array.isArray(c.fontes)).toBe(true);
      expect(c.fontes.length).toBeGreaterThan(0);
    }
    // Os 5 tipos de computação têm cobertura na lib.
    const usados = new Set(checks.map((c) => c.computacao.tipo));
    for (const t of tipos) expect(usados.has(t)).toBe(true);
  });
});

describe("verificar (veredito tricolor: 1 check sintético por cor)", () => {
  it("sustentado: números confirmam sem ressalva, com 3 números + hash", () => {
    const v = verificarAfirmacao(CHECK_SUSTENTADO, fato40());
    expect(v.veredito).toBe("sustentado");
    expect(v.numeros).toHaveLength(3);
    for (const n of v.numeros) {
      expect(typeof n.rotulo).toBe("string");
      expect(n.rotulo.length).toBeGreaterThan(0);
    }
    const html = htmlDe(CHECK_SUSTENTADO, CHECK_SUSTENTADO.slug, fato40());
    expect(html).toMatch(/Veredito: (<!-- -->)?sustentado/);
    expect(html).toContain("d".repeat(12));
    expect(html).toContain("dadosabertos.tse.jus.br");
  });
  it("enganoso: explica o engano, com 3 números + hash", () => {
    const v = verificarAfirmacao(CHECK_ENGANOSO, fato40());
    expect(v.veredito).toBe("enganoso");
    expect(v.numeros).toHaveLength(3);
    expect(typeof v.engano).toBe("string");
    expect((v.engano as string).length).toBeGreaterThan(20);
    const html = htmlDe(CHECK_ENGANOSO, CHECK_ENGANOSO.slug, fato40());
    expect(html).toMatch(/Veredito: (<!-- -->)?enganoso/);
    expect(html).toContain("d".repeat(12));
  });
  it("falso: números contradizem, com 3 números + hash", () => {
    // renda de onde A venceu == média nacional no sintético (demo
    // constante) → direção "maior" é falsa.
    const v = verificarAfirmacao(CHECK_FALSO, fato40());
    expect(v.veredito).toBe("falso");
    expect(v.numeros).toHaveLength(3);
    const html = htmlDe(CHECK_FALSO, CHECK_FALSO.slug, fato40());
    expect(html).toMatch(/Veredito: (<!-- -->)?falso/);
    expect(html).toContain("d".repeat(12));
  });
});

describe("verificar (fail-closed: sem fato, sem dado, série fora de escopo)", () => {
  it("fato null: sem dado oficial, sem veredito", () => {
    const v = verificarAfirmacao(CHECK_SUSTENTADO, null);
    expect(v.veredito).toBe(null);
    const html = htmlDe(CHECK_SUSTENTADO, CHECK_SUSTENTADO.slug, null);
    expect(html).toContain("sem dado oficial");
    expect(html).not.toContain('role="status"');
  });
  it("serie_temporal: fora de escopo (um pleito no fato), nunca veredito", () => {
    const check: Check = {
      slug: "sint-serie",
      frase: "A abstenção cresceu entre pleitos",
      computacao: { tipo: "serie_temporal", params: { assunto: "abstencao" } },
      fontes: FONTES,
    };
    const v = verificarAfirmacao(check, fato40());
    expect(v.veredito).toBe(null);
    const html = htmlDe(check, check.slug, fato40());
    expect(html).toContain("sem dado oficial");
    expect(html).toContain("um pleito");
    expect(html).not.toContain('role="status"');
  });
});

describe("verificar (unknown_claim_suggests)", () => {
  it("slug fora da lib -> sugestão, sem veredito", () => {
    const html = htmlDe(null, "afirmacao-que-nao-existe", fato40());
    expect(html).toContain("sugest");
    expect(html).not.toContain('role="status"');
    // Sugestão lista afirmações curadas (links), nunca um veredito.
    expect(html).toContain("/verificar/");
    expect(html).not.toContain("sem dado oficial");
  });
});

describe("verificar (?regiao= do painel: filtro ou sugestão)", () => {
  it("região com checks retorna só os daquela região; sem checks -> sugestão", () => {
    const checks = checksJson as unknown as Check[];
    const sp = checksParaRegiao(checks, "SP");
    expect(sp.length).toBeGreaterThan(0);
    for (const c of sp) expect(c.regiao).toBe("SP");
    expect(checksParaRegiao(checks, "ZZ")).toHaveLength(0);
  });
});

describe("verificar (?regiao= IBGE→UF: deep link de município filtra a UF)", () => {
  it("código IBGE de município SP normaliza para SP e casa nos checks", async () => {
    const { normalizarRegiao } = (await import("../app/verificar/page")).default;
    const checks = checksJson as unknown as Check[];
    expect(normalizarRegiao("3550308")).toBe("SP");
    expect(checksParaRegiao(checks, normalizarRegiao("3550308")).length).toBeGreaterThan(0);
  });
  it("tabela de prefixos IBGE cobre as 27 UFs; sigla passa intacta", async () => {
    const { normalizarRegiao } = (await import("../app/verificar/page")).default;
    const esperados: Array<[string, string]> = [
      ["11", "RO"], ["12", "AC"], ["13", "AM"], ["14", "RR"], ["15", "PA"],
      ["16", "AP"], ["17", "TO"], ["21", "MA"], ["22", "PI"], ["23", "CE"],
      ["24", "RN"], ["25", "PB"], ["26", "PE"], ["27", "AL"], ["28", "SE"],
      ["29", "BA"], ["31", "MG"], ["32", "ES"], ["33", "RJ"], ["35", "SP"],
      ["41", "PR"], ["42", "SC"], ["43", "RS"], ["50", "MS"], ["51", "MT"],
      ["52", "GO"], ["53", "DF"],
    ];
    expect(esperados).toHaveLength(27);
    for (const [prefixo, uf] of esperados) {
      expect(normalizarRegiao(`${prefixo}00000`)).toBe(uf);
    }
    expect(normalizarRegiao("sp")).toBe("SP");
    expect(normalizarRegiao(" SP ")).toBe("SP");
  });
  it("prefixo desconhecido ou sigla sem checks cai na sugestão (fail-closed, nunca UF errada)", async () => {
    const { normalizarRegiao } = (await import("../app/verificar/page")).default;
    const checks = checksJson as unknown as Check[];
    // Prefixo 99 não existe: mantém o cru → sem match → sugestão.
    expect(checksParaRegiao(checks, normalizarRegiao("9912345"))).toHaveLength(0);
    expect(checksParaRegiao(checks, normalizarRegiao("ZZ"))).toHaveLength(0);
  });
});

// Fato de 40 municípios a partir de pares (x = esc_sup, share de cand-a).
// Calibragem (Pearson sobre votos inteiros, mesmo cálculo do motor):
// tilt -0.00011 → r ≈ +0,0005; tilt -0.00012 → r ≈ -0,004;
// base 0,62, inclinação -0,004, ruído ±0,03 → r ≈ -0,83.
function fatoDe(pontos: { x: number; share: number }[]): FatoSintetico {
  return {
    candidatos: CANDIDATOS,
    municipios: pontos.map((p, i) => {
      const a = Math.round(p.share * 1000);
      return {
        ibge: `355030${i}`,
        uf: "SP",
        nome: `Município ${i}`,
        votos: [a, 1000 - a],
        total: 1000,
        abst: 150,
        demo: demo({ esc_sup: p.x }),
      };
    }),
  };
}

function pontos40(fn: (i: number) => number): { x: number; share: number }[] {
  const pts: { x: number; share: number }[] = [];
  for (let i = 0; i < 40; i++) pts.push({ x: 5 + i * 0.5, share: fn(i) });
  return pts;
}

const CHECK_SINAL_POSITIVO: Check = {
  slug: "sint-sinal",
  frase: "Lugares mais escolarizados votaram mais em A",
  computacao: {
    tipo: "correlacao_sinal",
    params: { quem: "cand-a", variavel: "esc_sup", sinal: "positivo" },
  },
  fontes: FONTES,
};

describe("verificar (correlação: nunca falso sobre ruído)", () => {
  it("ruído positivo (r ≈ +0,0005) → enganoso, nunca falso", () => {
    const fato = fatoDe(pontos40((i) => 0.5 - 0.00011 * i + (i % 2 ? 0.03 : -0.03)));
    const v = verificarAfirmacao(CHECK_SINAL_POSITIVO, fato);
    expect(v.veredito).toBe("enganoso");
    expect(v.veredito).not.toBe("falso");
    expect(v.numeros).toHaveLength(3);
  });
  it("ruído negativo (r ≈ -0,004) → enganoso, nunca falso", () => {
    const fato = fatoDe(pontos40((i) => 0.5 - 0.00012 * i + (i % 2 ? 0.03 : -0.03)));
    const v = verificarAfirmacao(CHECK_SINAL_POSITIVO, fato);
    expect(v.veredito).toBe("enganoso");
    expect(v.veredito).not.toBe("falso");
    expect(typeof v.engano).toBe("string");
    expect(v.engano as string).toContain("ruído");
  });
  it("sinal oposto claro (r ≈ -0,83) → falso preservado", () => {
    const fato = fatoDe(pontos40((i) => 0.62 - 0.004 * i + (i % 2 ? 0.03 : -0.03)));
    const v = verificarAfirmacao(CHECK_SINAL_POSITIVO, fato);
    expect(v.veredito).toBe("falso");
    expect(v.numeros).toHaveLength(3);
  });
  it("n < 30 → fail-closed (veredito null, sem status, sem números)", () => {
    const pts: { x: number; share: number }[] = [];
    for (let i = 0; i < 10; i++) pts.push({ x: 5 + i * 0.5, share: 0.5 + i * 0.01 });
    const fato = fatoDe(pts);
    const v = verificarAfirmacao(CHECK_SINAL_POSITIVO, fato);
    expect(v.veredito).toBe(null);
    const html = htmlDe(CHECK_SINAL_POSITIVO, CHECK_SINAL_POSITIVO.slug, fato);
    expect(html).toContain("sem dado oficial");
    expect(html).not.toContain('role="status"');
  });
});

describe("verificar (vencedor_regiao: piso de margem padrão 1%)", () => {
  function fatoFio(): FatoSintetico {
    // Agregado: A 100 × B 99 → margem 1/199 ≈ 0,5% < 1%.
    return {
      candidatos: CANDIDATOS,
      municipios: [
        { ibge: "1", uf: "SP", nome: "M1", votos: [100, 0], total: 100, abst: 10, demo: demo() },
        { ibge: "2", uf: "SP", nome: "M2", votos: [0, 99], total: 99, abst: 10, demo: demo() },
      ],
    };
  }
  it("vitória por 1 voto → enganoso com explicação (nunca sustentado sem ressalva)", () => {
    const v = verificarAfirmacao(CHECK_SUSTENTADO, fatoFio());
    expect(v.veredito).toBe("enganoso");
    expect(v.veredito).not.toBe("sustentado");
    expect(v.numeros).toHaveLength(3);
    expect(typeof v.engano).toBe("string");
    expect(v.engano as string).toContain("fio");
  });
  it("vitória confortável → sustentado sem ressalva preservado", () => {
    const v = verificarAfirmacao(CHECK_SUSTENTADO, fato40());
    expect(v.veredito).toBe("sustentado");
    expect(v.engano).toBeUndefined();
    expect(v.numeros).toHaveLength(3);
  });
  it("margem abaixo da margem explícita afirmada → falso (não enganoso)", () => {
    // Afirma folga de 10pp; vitória por 4pp contradiz o número afirmado.
    const check: Check = {
      slug: "sint-margem-explicita",
      frase: "A venceu com folga (margem acima de 10 pontos)",
      computacao: {
        tipo: "vencedor_regiao",
        params: { quem: "@vencedor", regiao: "BR", margem_min: 0.1 },
      },
      fontes: FONTES,
    };
    const fato: FatoSintetico = {
      candidatos: CANDIDATOS,
      municipios: [
        { ibge: "1", uf: "SP", nome: "M1", votos: [520, 480], total: 1000, abst: 10, demo: demo() },
      ],
    };
    const v = verificarAfirmacao(check, fato);
    expect(v.veredito).toBe("falso");
    expect(v.numeros).toHaveLength(3);
    const html = htmlDe(check, check.slug, fato);
    expect(html).toMatch(/Veredito: (<!-- -->)?falso/);
  });
  it("margem acima da margem explícita afirmada → sustentado", () => {
    const check: Check = {
      slug: "sint-margem-explicita-ok",
      frase: "A venceu com folga (margem acima de 10 pontos)",
      computacao: {
        tipo: "vencedor_regiao",
        params: { quem: "@vencedor", regiao: "BR", margem_min: 0.1 },
      },
      fontes: FONTES,
    };
    const fato: FatoSintetico = {
      candidatos: CANDIDATOS,
      municipios: [
        { ibge: "1", uf: "SP", nome: "M1", votos: [600, 400], total: 1000, abst: 10, demo: demo() },
      ],
    };
    const v = verificarAfirmacao(check, fato);
    expect(v.veredito).toBe("sustentado");
    expect(v.numeros).toHaveLength(3);
  });
});

describe("verificar (soma_condicional: limiares no lado afirmado)", () => {
  const CHECK_MINORIA: Check = {
    slug: "sint-minoria",
    frase: "Na minoria dos municípios a disputa foi apertada (margem abaixo de 5 pontos)",
    computacao: {
      tipo: "soma_condicional",
      params: { medida: "margem", limiar: 0.05, lado: "abaixo", afirma_maioria: false },
    },
    fontes: FONTES,
  };
  function fatoMargens(apertadas: number, folgadas: number): FatoSintetico {
    const municipios: MunRow[] = [];
    for (let i = 0; i < apertadas; i++) {
      municipios.push({
        ibge: `a${i}`, uf: "SP", nome: `Ap ${i}`,
        votos: [510, 490], total: 1000, abst: 10, demo: demo(),
      });
    }
    for (let i = 0; i < folgadas; i++) {
      municipios.push({
        ibge: `f${i}`, uf: "SP", nome: `Fo ${i}`,
        votos: [600, 400], total: 1000, abst: 10, demo: demo(),
      });
    }
    return { candidatos: CANDIDATOS, municipios };
  }
  it("afirma minoria com 20% na condição → sustentado (lado alinhado 80% ≥ 60%)", () => {
    const v = verificarAfirmacao(CHECK_MINORIA, fatoMargens(1, 4));
    expect(v.veredito).toBe("sustentado");
    expect(v.numeros).toHaveLength(3);
  });
  it("afirma minoria com 80% na condição → falso (lado alinhado 20% ≤ 50%)", () => {
    const v = verificarAfirmacao(CHECK_MINORIA, fatoMargens(4, 1));
    expect(v.veredito).toBe("falso");
    expect(v.numeros).toHaveLength(3);
  });
});

describe("verificar (correlação: Pearson e Spearman precisam concordar)", () => {
  it("Pearson forte pelo outlier com Spearman oposto → enganoso, nunca sustentado", () => {
    // 39 pontos em queda + 1 outlier (x alto, share alto): Pearson vira
    // positivo forte, Spearman segue negativo forte.
    const pontos: { x: number; share: number }[] = [];
    for (let i = 0; i < 39; i++) {
      pontos.push({ x: 5 + i * 0.5, share: 0.62 - 0.004 * i + (i % 2 ? 0.03 : -0.03) });
    }
    pontos.push({ x: 200, share: 0.99 });
    const fato = fatoDe(pontos);
    const v = verificarAfirmacao(CHECK_SINAL_POSITIVO, fato);
    expect(v.veredito).toBe("enganoso");
    expect(v.veredito).not.toBe("sustentado");
    expect(v.veredito).not.toBe("falso");
    expect(v.numeros).toHaveLength(3);
    expect(typeof v.engano).toBe("string");
  });
});

describe("verificar (fail-closed sem hash: sem dado oficial, nunca veredito)", () => {
  const SEAL_SEM_HASH: SealState = { official: null, hasFixture: false, fixtureHash: "" };
  it("fato com ingestão sem hash → sem dado oficial, sem veredito", () => {
    const html = renderToStaticMarkup(
      React.createElement(VerificarConteudo, {
        check: CHECK_SUSTENTADO,
        slug: CHECK_SUSTENTADO.slug,
        checks: checksJson as unknown as Check[],
        fato: fato40(),
        seal: SEAL_SEM_HASH,
        manifestChecked: true,
      }),
    );
    expect(html).toContain("sem dado oficial");
    expect(html).not.toContain('role="status"');
  });
  it("fixture com hash → veredito preservado (transparência, sem selo oficial)", () => {
    const sealFixture: SealState = { official: null, hasFixture: true, fixtureHash: "c".repeat(64) };
    const html = renderToStaticMarkup(
      React.createElement(VerificarConteudo, {
        check: CHECK_SUSTENTADO,
        slug: CHECK_SUSTENTADO.slug,
        checks: checksJson as unknown as Check[],
        fato: fato40(),
        seal: sealFixture,
        manifestChecked: true,
      }),
    );
    expect(html).toMatch(/Veredito: (<!-- -->)?sustentado/);
  });
  it("official com hash vazio → semProva (paridade com Explorar/Curada)", () => {
    const sealVazio: SealState = { official: { hash: "", url: "", date: "" }, hasFixture: false, fixtureHash: "" };
    const html = renderToStaticMarkup(
      React.createElement(VerificarConteudo, {
        check: CHECK_SUSTENTADO,
        slug: CHECK_SUSTENTADO.slug,
        checks: checksJson as unknown as Check[],
        fato: fato40(),
        seal: sealVazio,
        manifestChecked: true,
      }),
    );
    expect(html).toContain("sem dado oficial");
    expect(html).not.toMatch(/Veredito: (<!-- -->)?(sustentado|enganoso|falso)/);
  });
});
