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
    const ss = html.match(/<section\b[\s\S]*?<\/section>/g) ?? [];
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
      // A nota de piso vive na seção Correlação — só as perguntas que
      // pedem dispersao a exibem (blocos.ver honored); as demais seguem
      // fail-closed com sem-dado nas seções que mostram.
      if ((p.blocos.ver as string[]).includes("dispersao")) {
        expect(html).toContain("piso n ≥ 30");
      }
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

describe("curada (Resultado mostra o share médio ponderado afirmado)", () => {
  it("Resultado exibe share médio ponderado de quem, com %", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    const resultado = html.split('aria-label="Resultado"')[1].split("<section")[0];
    expect(resultado).toContain("share médio");
    expect(resultado).toMatch(/%/);
  });
});

describe("curada (segundo lugar: perfil de vitória não se aplica)", () => {
  function fatoMisto(): FatoSintetico {
    const municipios: MunRow[] = [];
    for (let i = 0; i < 20; i++) {
      municipios.push({
        ibge: `355030${i}`, uf: "SP", nome: `A ${i}`,
        votos: [600, 400], total: 1000, abst: 50, demo: demo({ esc_sup: 5 + i * 0.5 }),
      });
    }
    for (let i = 0; i < 20; i++) {
      municipios.push({
        ibge: `350010${i}`, uf: "SP", nome: `B ${i}`,
        votos: [400, 600], total: 1000, abst: 50, demo: demo({ esc_sup: 5 + i * 0.5 }),
      });
    }
    return { candidatos: CANDIDATOS, municipios };
  }
  it("onde=segundo: título honesto + nota explícita, nunca sem-dado enganoso", () => {
    const base = perguntas.find((q) => q.slug === "onde-foi-segundo-vencedor")!;
    const pergunta = { ...base, blocos: { ...base.blocos, ver: ["tabela", "ranking"] } };
    const html = renderToStaticMarkup(el(pergunta, fatoMisto(), SEAL_OK));
    expect(html).toContain("2º lugar");
    expect(html).toContain("perfil de vitória não se aplica");
    expect(html).not.toContain("Perfil de onde Candidata Exemplo A venceu");
  });
});

describe("curada (supressão distingue n<30 de variância zero)", () => {
  function fatoConstante(): FatoSintetico {
    const municipios: MunRow[] = [];
    for (let i = 0; i < 40; i++) {
      const a = 500 + i * 10;
      municipios.push({
        ibge: `355030${i}`, uf: "SP", nome: `Município ${i}`,
        votos: [a, 1000 - a], total: 1000, abst: 50,
        demo: demo({ esc_sup: 10 }),
      });
    }
    return { candidatos: CANDIDATOS, municipios };
  }
  it("variância zero com n=40: Resultado diz variância zero, não insuficiência", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = htmlDe(p, fatoConstante(), SEAL_OK);
    const resultado = html.split('aria-label="Resultado"')[1].split("<section")[0];
    expect(resultado).toContain("variância zero");
    expect(resultado).not.toContain("insuficientes");
  });
});

describe("curada (reprodução fail-closed por escopo)", () => {
  function fonteDe(html: string): string {
    return html.split('aria-label="Fonte e reprodu')[1].split("<section")[0];
  }
  it("exterior/evolução: sem URL de reprodução (escopo fora do explorar)", () => {
    for (const slug of ["voto-exterior", "evolucao-vencedor"]) {
      const p = perguntas.find((q) => q.slug === slug)!;
      const fonte = fonteDe(htmlDe(p, fato40(), SEAL_OK));
      expect(fonte).not.toContain("/explorar?q=");
      expect(fonte).toContain("reprodução indisponível");
    }
  });
  it("escopo coberto: URL de reprodução preservada", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    expect(fonteDe(htmlDe(p, fato40(), SEAL_OK))).toContain("/explorar?q=");
  });
});

describe("curada (blocos.ver honored: só as visões pedidas renderizam)", () => {
  it("ranking-only não mostra Correlação nem Perfil; mostra Ranking", () => {
    const p = perguntas.find((q) => q.slug === "margem-ampla-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    expect(html).not.toContain('aria-label="Correlação"');
    expect(html).not.toContain('aria-label="Perfil de onde venceu"');
    expect(html).toContain('aria-label="Ranking"');
  });
  it("dispersao mostra Correlação; tabela mostra Perfil", () => {
    const htmlDisp = htmlDe(perguntas.find((q) => q.slug === "estudo-voto-vencedor")!, fato40(), SEAL_OK);
    expect(htmlDisp).toContain('aria-label="Correlação"');
    expect(htmlDisp).not.toContain('aria-label="Ranking"');
    const htmlTab = htmlDe(perguntas.find((q) => q.slug === "perfil-onde-venceu-vencedor")!, fato40(), SEAL_OK);
    expect(htmlTab).toContain('aria-label="Perfil de onde venceu"');
    expect(htmlTab).not.toContain('aria-label="Ranking"');
  });
});

const SEAL_FIXTURE: SealState = { official: null, hasFixture: true, fixtureHash: "c".repeat(64) };
const SEAL_HASH_VAZIO: SealState = { official: { hash: "", url: "", date: "" }, hasFixture: false, fixtureHash: "" };

function secaoResultadoCurada(html: string): string {
  return html.split('aria-label="Resultado"')[1].split("<section")[0];
}

describe("curada (gate de hash: fato sem hash não sustenta número)", () => {
  it("fato presente sem hash → Resultado SEM_DADO, sem r nem share", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const resultado = secaoResultadoCurada(htmlDe(p, fato40(), SEAL_NULO));
    expect(resultado).toContain("sem dado oficial");
    expect(resultado).not.toMatch(/r \(Pearson\) = -?\d/);
    expect(resultado).not.toMatch(/share médio[^%]*%/);
  });
  it("selo fixture com hash segue sustentando números (paridade com Verificar)", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    expect(secaoResultadoCurada(htmlDe(p, fato40(), SEAL_FIXTURE))).toMatch(
      /r \(Pearson\) = -?\d/,
    );
  });
  it("official com hash vazio → SEM_DADO, sem r nem share (paridade com Verificar)", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const resultado = secaoResultadoCurada(htmlDe(p, fato40(), SEAL_HASH_VAZIO));
    expect(resultado).toContain("sem dado oficial");
    expect(resultado).not.toMatch(/r \(Pearson\) = -?\d/);
    expect(resultado).not.toMatch(/share médio[^%]*%/);
  });
  it("selo com hash + fato null → Método SEM_DADO (sem n=0, sem veredito)", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = htmlDe(p, null, SEAL_OK);
    const metodo = html.split('aria-label="Método"')[1].split("<section")[0];
    expect(metodo).toContain("sem dado oficial");
    expect(metodo).not.toMatch(/n = 0/);
    expect(metodo).not.toContain("veredito:");
  });
  it("Método com fato+hash segue exibindo n e veredito (sem regressão)", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    const metodo = html.split('aria-label="Método"')[1].split("<section")[0];
    expect(metodo).toMatch(/n = 40 municípios/);
    expect(metodo).toContain("veredito:");
  });
  it("perfil sem hash nomeia o hash ausente (paridade Resultado/Método)", () => {
    const p = perguntas.find((q) => q.slug === "perfil-onde-venceu-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_NULO);
    const perfil = html.split('aria-label="Perfil de onde venceu"')[1].split("<section")[0];
    expect(perfil).toContain("sem dado oficial");
    expect(perfil).toContain("sem hash auditado no manifest");
  });
  it("escopo fora do fato + hash válido mantém a nota de escopo (sem regressão)", () => {
    const p = perguntas.find((q) => q.slug === "voto-exterior")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    const perfil = html.split('aria-label="Perfil de onde venceu"')[1].split("<section")[0];
    expect(perfil).toContain("fora do fato municipal");
  });
});

// Uma linha sem eleitorado auditado -> fallback total (pesoFonte misto no motor).
function linhasMistas(): MunRow[] {
  return linhas40().map((r, i) =>
    i === 0 ? { ...r, demo: { ...r.demo!, eleitores: null } } : r,
  );
}

function secaoPerfilCurada(html: string): string {
  return html.split('aria-label="Perfil de onde venceu"')[1].split("<section")[0];
}

describe("curada (rótulo pt-BR do peso: sem valor cru do motor)", () => {
  it("peso eleitorado: 'eleitores (peso: eleitorado)', sem valor cru", () => {
    const p = perguntas.find((q) => q.slug === "perfil-onde-venceu-vencedor")!;
    const perfil = secaoPerfilCurada(htmlDe(p, fato40(), SEAL_OK));
    expect(perfil).toContain("eleitores (peso: eleitorado)");
    expect(perfil).not.toContain("(peso: eleitores)");
    expect(perfil).not.toContain("(peso: misto)");
  });
  it("peso misto: peso efetivo, sem rótulo 'eleitores' (nEleitores inclui fallback)", () => {
    const p = perguntas.find((q) => q.slug === "perfil-onde-venceu-vencedor")!;
    const perfil = secaoPerfilCurada(
      htmlDe(p, { candidatos: CANDIDATOS, municipios: linhasMistas() }, SEAL_OK),
    );
    expect(perfil).toContain("de peso efetivo (eleitorado, total ou população)");
    expect(perfil).not.toContain("eleitores (peso:");
    expect(perfil).not.toContain("(peso: misto)");
  });
});

describe("curada (decimais pt-BR: vírgula, nunca ponto)", () => {
  it("r (Pearson/Spearman) renderiza com vírgula", () => {
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = htmlDe(p, fato40(), SEAL_OK);
    expect(html).toMatch(/r \(Pearson\) = -?\d+,\d{3}/);
    expect(html).not.toMatch(/r \(Pearson\) = -?\d+\.\d{3}/);
    expect(html).not.toMatch(/r \(Spearman\) = -?\d+\.\d{3}/);
  });
});
