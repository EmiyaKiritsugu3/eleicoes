import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import perguntas from "../data/perguntas.json";
import { CuradaConteudo, resolverCandidato } from "../app/perguntas/Curada";
import { ECO_SEAL } from "../components/PainelRegiao";
import type { SealState } from "../lib/data";
import { VAR_DEMO, type MunRow } from "../lib/motor";

// Fato sintético: 40 municípios, A vence todos; share de A cresce com
// esc_sup (correlação forte, n = 40 ≥ piso 30). Nenhum arquivo de fato
// real é lido aqui (pure functions sobre MunRow sintéticas).
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
    const a = 500 + i * 10;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Município ${i}`,
      votos: [a, 1000 - a],
      total: 1000,
      abst: 50,
      demo: demo({
        esc_sup: 5 + i * 0.5,
        renda_media: 1500 + i * 50,
        pobres_pct: 30 - i * 0.4,
        idade_mediana: 30 + i * 0.2,
        urbanizacao: 60 + i * 0.8,
      }),
    });
  }
  return rows;
}

// 5 municípios (abaixo do piso n ≥ 30): correlação suprimida, nunca zerada.
function linhas5(): MunRow[] {
  return linhas40().slice(0, 5);
}

const SEAL_OK = {
  official: {
    hash: "c".repeat(64),
    url: "https://exemplo.tse.jus.br/fato.json",
    date: "2026-01-01",
  },
  hasFixture: false,
  fixtureHash: "",
};

const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };

function el(
  pergunta: (typeof perguntas)[number],
  fato: FatoSintetico,
  seal: SealState,
): React.ReactElement {
  return React.createElement(CuradaConteudo, {
    pergunta,
    fato,
    seal,
    manifestChecked: true,
  });
}

function htmlDe(
  pergunta: (typeof perguntas)[number],
  fato: FatoSintetico,
  seal: SealState,
): string {
  return renderToStaticMarkup(el(pergunta, fato, seal));
}

function fato40(): FatoSintetico {
  return { candidatos: CANDIDATOS, municipios: linhas40() };
}

function fato5(): FatoSintetico {
  return { candidatos: CANDIDATOS, municipios: linhas5() };
}

const ONDE_VALIDOS = new Set([
  "venceu",
  "segundo",
  "margem_10",
  "participacao_80",
  "exterior",
  "evolucao",
]);

describe("curada (perguntas.json: 30 entradas, shape exato)", () => {
  it("30 entradas, slugs únicos, shape {slug, titulo, blocos, texto_metodo}", () => {
    expect(perguntas).toHaveLength(30);
    const slugs = perguntas.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(30);
    for (const p of perguntas) {
      expect(typeof p.slug).toBe("string");
      expect(p.slug.length).toBeGreaterThan(0);
      expect(typeof p.titulo).toBe("string");
      expect(p.titulo.length).toBeGreaterThan(0);
      expect(typeof p.blocos.quem).toBe("string");
      expect(typeof p.blocos.onde).toBe("string");
      expect(typeof p.blocos.cruzar).toBe("string");
      expect(Array.isArray(p.blocos.ver)).toBe(true);
      expect(typeof p.texto_metodo).toBe("string");
      expect(p.texto_metodo.length).toBeGreaterThan(20);
      expect(ONDE_VALIDOS.has(p.blocos.onde)).toBe(true);
      expect((VAR_DEMO as readonly string[]).includes(p.blocos.cruzar)).toBe(true);
    }
  });
});

describe("curada (resolverCandidato: tokens @vencedor/@vice)", () => {
  it("@vencedor resolve para quem mais somou votos (cand-a)", () => {
    expect(resolverCandidato(fato40(), "@vencedor")?.id).toBe("cand-a");
  });
  it("@vice resolve para o segundo (cand-b)", () => {
    expect(resolverCandidato(fato40(), "@vice")?.id).toBe("cand-b");
  });
  it("id literal resolve direto; desconhecido dá null (fail-closed)", () => {
    expect(resolverCandidato(fato40(), "cand-a")?.id).toBe("cand-a");
    expect(resolverCandidato(fato40(), "zz")).toBe(null);
    expect(resolverCandidato(null, "@vencedor")).toBe(null);
  });
});

describe("curada (todas as 30 computam sem throw sobre dado sintético)", () => {
  for (const p of perguntas) {
    it(`computa ${p.slug} sem throw, com fonte+hash e selo ecológico`, () => {
      let html = "";
      expect(() => {
        html = htmlDe(p, fato40(), SEAL_OK);
      }).not.toThrow();
      expect(html).toContain(p.titulo);
      expect(html).toContain(p.texto_metodo);
      // fonte+hash (pixel-mentiroso p/ curada): selo oficial visível.
      expect(html).toContain("fonte auditada");
      expect(html).toContain("c".repeat(12));
      // Selo ecológico nas seções de perfil/correlação.
      expect(html).toContain(ECO_SEAL);
    });
  }
});

describe("curada (pixel-mentiroso: toda seção exibe fonte+hash)", () => {
  const HASH_SHORT = "c".repeat(12);
  function secaoHonesta(s: string): boolean {
    return (
      s.includes(HASH_SHORT) ||
      s.includes("fonte auditada") ||
      s.includes("dado não auditado")
    );
  }
  function secoesDe(html: string): string[] {
    const ss = html.split("<section").slice(1);
    expect(ss.length).toBeGreaterThan(0);
    return ss;
  }
  for (const slug of [
    "perfil-onde-venceu-vencedor",
    "estudo-voto-vencedor",
    "margem-ampla-vencedor",
    "voto-exterior",
  ]) {
    it(`seções honestas em ${slug} (selo oficial)`, () => {
      const p = perguntas.find((q) => q.slug === slug)!;
      for (const s of secoesDe(htmlDe(p, fato40(), SEAL_OK))) {
        expect(secaoHonesta(s)).toBe(true);
      }
    });
    it(`seções honestas em ${slug} (sem selo: aviso, nunca número oficial)`, () => {
      const p = perguntas.find((q) => q.slug === slug)!;
      const html = htmlDe(p, fato40(), SEAL_NULO);
      expect(html).not.toContain("fonte auditada");
      for (const s of secoesDe(html)) expect(secaoHonesta(s)).toBe(true);
    });
  }
});

describe("curada (supressão n < 30 honrada, nunca zero silencioso)", () => {
  it("quintis [] vira nota de supressão com piso, em todas as 30", () => {
    for (const p of perguntas) {
      let html = "";
      expect(() => {
        html = htmlDe(p, fato5(), SEAL_OK);
      }).not.toThrow();
      expect(html).toContain("sem dado oficial");
      expect(html).toContain("piso n ≥ 30");
      expect(html).toContain("fonte auditada");
    }
  });
});

describe("curada (fail-closed sem fato + escopos fora do fato municipal)", () => {
  it("fato null: sem dado oficial em todas as 30, selo segue honesto", () => {
    for (const p of perguntas) {
      const html = htmlDe(p, null, SEAL_NULO);
      expect(html).toContain("sem dado oficial");
      expect(html).toContain("dado não auditado");
    }
  });
  it("voto-exterior: nota de escopo (fora do fato municipal), sem throw", () => {
    const p = perguntas.find((q) => q.slug === "voto-exterior")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    expect(html).toContain("exterior fora do fato municipal");
    expect(html).toContain("sem dado oficial");
  });
  it("evolucao: nota de escopo (um pleito no fato), sem throw", () => {
    const p = perguntas.find((q) => q.slug === "evolucao-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    expect(html).toContain("um pleito");
    expect(html).toContain("sem dado oficial");
  });
});
