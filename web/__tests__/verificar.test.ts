import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import checksJson from "../data/checks.json";
import {
  VerificarConteudo,
  verificarAfirmacao,
  checksParaRegiao,
  type Check,
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
    const tipos = new Set([
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
    expect(html).toContain("sustentado");
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
    expect(html).toContain("enganoso");
    expect(html).toContain("d".repeat(12));
  });
  it("falso: números contradizem, com 3 números + hash", () => {
    // renda de onde A venceu == média nacional no sintético (demo
    // constante) → direção "maior" é falsa.
    const v = verificarAfirmacao(CHECK_FALSO, fato40());
    expect(v.veredito).toBe("falso");
    expect(v.numeros).toHaveLength(3);
    const html = htmlDe(CHECK_FALSO, CHECK_FALSO.slug, fato40());
    expect(html).toContain("falso");
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
