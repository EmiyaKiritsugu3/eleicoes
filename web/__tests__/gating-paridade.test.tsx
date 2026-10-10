// @vitest-environment jsdom
// EVOLVE-3 Task 4 (ruling a): Home (/ via HomeContent) e /analisar suprimem
// números como Explorar/Curada — manifest inválido → "sem dado oficial" nas
// 4 superfícies (paridade fail-closed), nunca número + banner.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeContent } from "../components/HomeContent";
import Analisar from "../app/analisar/page";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import { CuradaConteudo } from "../app/perguntas/Curada";
import { VerificarConteudo, type Check } from "../app/verificar/Verificar";
import { getSealState } from "../lib/data";
import { MOTIVO_SEM_HASH } from "../lib/textos";
import perguntas from "../data/perguntas.json";
import checksJson from "../data/checks.json";
import {
  SEM_DADO,
  MANIFEST_OK,
  MANIFEST_INVALIDO,
  responderBasico,
  renderJsdom,
  teardownJsdom,
  secao,
  CANDIDATOS_EXEMPLO as CANDIDATOS,
  demoBase,
  municipios40Linear,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Manifest só-fixture com hash válido: vereditoTemProva true → números
// seguem visíveis (sem selo oficial), paridade Explorar/Curada.
const MANIFEST_FIXTURE = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "f".repeat(64), date: "2026-01-01", fixture: true },
  ],
};

function mockFetch(manifest: unknown) {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) =>
    responderBasico(String(url), manifest, null, null),
  );
}

afterEach(teardownJsdom);

// Renderiza /analisar com a query dada (o effect hidrata modo/a/b da URL
// via parseAnalisarSearchParams); restaura "/" ao final para não vazar
// estado entre testes.
async function renderAnalisarComQuery(qs: string): Promise<HTMLDivElement> {
  window.history.replaceState({}, "", qs);
  try {
    return await renderJsdom(<Analisar />);
  } finally {
    window.history.replaceState({}, "", "/");
  }
}

// Fato p/ Explorar/Curada (40 municípios, n ≥ piso 30).
function demo(i: number) {
  return demoBase(5 + i * 0.5, 2000);
}
function fato40() {
  return {
    candidatos: CANDIDATOS,
    municipios: municipios40Linear({ nome: (i) => `Município ${i}`, abst: 50, demo }),
  };
}
const SEL_VALIDA: ExplorarSelecao = {
  quem: "cand-a", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"], foco: "",
};

describe("gating-paridade Task 4: manifest inválido suprime nas 4 superfícies", () => {
  it("Home: banner + SEM_DADO em Resumo/UF/Ranking/Evolução, sem números", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<HomeContent />);
    const html = div.innerHTML;
    expect(html).toContain("dado não auditado");
    for (const s of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const corpo = secao(html, s);
      expect(corpo).not.toBe("");
      expect(corpo).toContain(SEM_DADO);
    }
    expect(secao(html, "Resumo")).not.toContain("Total de votos:");
  });
  it("/analisar: banner + SEM_DADO em Resumo/Pivô/Série, sem números", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const html = div.innerHTML;
    expect(html).toContain("dado não auditado");
    for (const s of ["Resumo filtrado", "Pivô", "Série histórica", "Comparador", "Dispersão votos x financiamento"]) {
      const corpo = secao(html, s);
      expect(corpo).not.toBe("");
      expect(corpo).toContain(SEM_DADO);
    }
    expect(secao(html, "Resumo filtrado")).not.toContain("Total de votos no filtro:");
  });
  it("/analisar Comparador com lados selecionados (?a=a&b=a): inválido → SEM_DADO, sem Votos", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderAnalisarComQuery("/analisar?modo=candidatos&a=a&b=a");
    const comp = secao(div.innerHTML, "Comparador");
    expect(comp).not.toBe("");
    expect(comp).toContain(SEM_DADO);
    expect(comp).not.toContain("Votos:");
  });
  it("/analisar Dispersão com dado financiado: inválido → SEM_DADO, sem número", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const disp = secao(div.innerHTML, "Dispersão votos x financiamento");
    expect(disp).not.toBe("");
    expect(disp).toContain(SEM_DADO);
    expect(disp).not.toContain("5.000");
  });
  it("Explorar: selo vazio → Resultado SEM_DADO, sem r", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={fato40()} seal={seal} initial={SEL_VALIDA} />,
    );
    const resultado = html.split('aria-label="Resultado"')[1].split("<section")[0];
    expect(resultado).toContain(SEM_DADO);
    expect(resultado).not.toMatch(/r \(Pearson\) = -?\d/);
  });
  it("Curada: selo vazio → Resultado SEM_DADO, sem r nem percentual", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={p} fato={fato40()} seal={seal} manifestChecked />,
    );
    const resultado = html.split('aria-label="Resultado"')[1].split("<section")[0];
    expect(resultado).toContain(SEM_DADO);
    expect(resultado).not.toMatch(/r \(Pearson\) = -?\d/);
    expect(resultado).not.toMatch(/percentual médio de votos[^%]*%/);
  });
});

describe("gating-paridade Task 4: controle — manifest válido segue com números", () => {
  it("Home com selo oficial exibe totais (sem regressão)", async () => {
    mockFetch(MANIFEST_OK);
    const div = await renderJsdom(<HomeContent />);
    expect(secao(div.innerHTML, "Resumo")).toContain("Total de votos:");
  });
  it("/analisar com selo oficial exibe totais (sem regressão)", async () => {
    mockFetch(MANIFEST_OK);
    const div = await renderJsdom(<Analisar />);
    expect(secao(div.innerHTML, "Resumo filtrado")).toContain("Total de votos no filtro:");
  });
  it("Home com manifest só-fixture (hash válido) exibe totais, sem supressão", async () => {
    mockFetch(MANIFEST_FIXTURE);
    const div = await renderJsdom(<HomeContent />);
    const html = div.innerHTML;
    expect(html).not.toContain("fonte auditada");
    expect(secao(html, "Resumo")).toContain("Total de votos:");
    expect(secao(html, "Resumo")).not.toContain(SEM_DADO);
  });
  it("/analisar com manifest só-fixture (hash válido) exibe totais, sem supressão", async () => {
    mockFetch(MANIFEST_FIXTURE);
    const div = await renderJsdom(<Analisar />);
    const html = div.innerHTML;
    expect(html).not.toContain("fonte auditada");
    expect(secao(html, "Resumo filtrado")).toContain("Total de votos no filtro:");
    expect(secao(html, "Pivô")).not.toContain(SEM_DADO);
  });
  it("/analisar Comparador com lados selecionados: selo oficial exibe Votos (sem regressão)", async () => {
    mockFetch(MANIFEST_OK);
    const div = await renderAnalisarComQuery("/analisar?modo=candidatos&a=a&b=a");
    expect(secao(div.innerHTML, "Comparador")).toContain("Votos: 2.500");
  });
  it("/analisar Dispersão com dado financiado: selo oficial exibe tabela (sem regressão)", async () => {
    mockFetch(MANIFEST_OK);
    const div = await renderJsdom(<Analisar />);
    const disp = secao(div.innerHTML, "Dispersão votos x financiamento");
    expect(disp).toContain("5.000");
    expect(disp).not.toContain(SEM_DADO);
  });
});

describe("task 6: paridade de motivos de supressão (reason correta, não só SEM_DADO)", () => {
  const HASH_REASON = "sem hash auditado no manifest";
  const PERG_CORR = {
    slug: "t6-corr", titulo: "t6",
    blocos: { quem: "@vencedor", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"] },
    texto_metodo: "m",
  };
  const PERG_RANK = {
    slug: "t6-rank", titulo: "t6",
    blocos: { quem: "@vencedor", onde: "venceu", cruzar: "esc_sup", ver: ["ranking"] },
    texto_metodo: "m",
  };
  function secaoEstatica(html: string, label: string): string {
    return html.split(`aria-label="${label}"`)[1].split("<section")[0];
  }
  it("/analisar Dispersão semProva nomeia o hash (não 'financiamento sem fonte')", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const disp = secao(div.innerHTML, "Dispersão votos x financiamento");
    expect(disp).toContain(SEM_DADO);
    expect(disp).toContain(HASH_REASON);
    expect(disp).not.toContain("financiamento sem fonte");
  });
  it("Curada Correlação sem hash nomeia o hash (paridade Resultado :283)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={PERG_CORR} fato={fato40()} seal={seal} manifestChecked />,
    );
    const corr = secaoEstatica(html, "Correlação");
    expect(corr).toContain(SEM_DADO);
    expect(corr).toContain(HASH_REASON);
  });
  it("Curada Por quê sem hash nomeia o hash (supressão vence escopo)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    // `onde` com escopo (exterior): regressão que mostrasse o motivo de
    // escopo em vez do hash seria capturada (falta HASH_REASON + sobra escopo).
    const perguntaEscopo = { ...PERG_CORR, blocos: { ...PERG_CORR.blocos, onde: "exterior" } };
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={perguntaEscopo} fato={fato40()} seal={seal} manifestChecked />,
    );
    const pq = secaoEstatica(html, "Por quê");
    expect(pq).toContain(SEM_DADO);
    expect(pq).toContain(HASH_REASON);
    expect(pq).not.toContain("fora do escopo auditado");
  });
  it("Curada Ranking sem hash nomeia o hash (não 'sem cobertura')", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={PERG_RANK} fato={fato40()} seal={seal} manifestChecked />,
    );
    const rank = secaoEstatica(html, "Ranking");
    expect(rank).toContain(SEM_DADO);
    expect(rank).toContain(HASH_REASON);
    expect(rank).not.toContain("sem cobertura neste recorte");
  });
  it("Explorar Resultado fato null sem hash nomeia o hash (paridade Curada :283)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={null} seal={seal} initial={SEL_VALIDA} />,
    );
    const resultado = secaoEstatica(html, "Resultado");
    expect(resultado).toContain(SEM_DADO);
    expect(resultado).toContain(HASH_REASON);
  });
  it("Explorar Mapa fato null sem hash nomeia o hash", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={null} seal={seal} initial={{ ...SEL_VALIDA, ver: ["mapa"] }} />,
    );
    const mapa = secaoEstatica(html, "Mapa");
    expect(mapa).toContain(SEM_DADO);
    expect(mapa).toContain(HASH_REASON);
  });
});

describe("task 2 (evolve-6): paridade de motivos — Home + Verificar usam MOTIVO_SEM_HASH", () => {
  const COM_MOTIVO = `${SEM_DADO} — ${MOTIVO_SEM_HASH}`;
  function secaoEstaticaT2(html: string, label: string): string {
    return html.split(`aria-label="${label}"`)[1].split("<section")[0];
  }
  it("Home semProva: Resumo/UF/Ranking/Evolução trazem SEM_DADO + motivo (nunca bare)", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<HomeContent />);
    const html = div.innerHTML;
    for (const s of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const corpo = secao(html, s);
      expect(corpo).not.toBe("");
      expect(corpo).toContain(COM_MOTIVO);
    }
  });
  it("Home com selo oficial: Resumo com números, sem motivo (sem regressão)", async () => {
    mockFetch(MANIFEST_OK);
    const div = await renderJsdom(<HomeContent />);
    const resumo = secao(div.innerHTML, "Resumo");
    expect(resumo).toContain("Total de votos:");
    expect(resumo).not.toContain(MOTIVO_SEM_HASH);
  });
  it("Explorar Resultado semProva rende a string exata da constante (paridade)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={null} seal={seal} initial={SEL_VALIDA} />,
    );
    expect(secaoEstaticaT2(html, "Resultado")).toContain(COM_MOTIVO);
  });
  it("Curada Resultado semProva rende a string exata da constante (paridade :283)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={p} fato={fato40()} seal={seal} manifestChecked />,
    );
    expect(secaoEstaticaT2(html, "Resultado")).toContain(COM_MOTIVO);
  });
  it("Verificar semProva: Veredito traz o motivo da constante (drift :549 normalizado)", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const checks = checksJson as unknown as Check[];
    const html = renderToStaticMarkup(
      <VerificarConteudo check={checks[0]} slug={checks[0].slug} checks={checks} fato={null} seal={seal} manifestChecked />,
    );
    const veredito = secaoEstaticaT2(html, "Veredito");
    expect(veredito).toContain(SEM_DADO);
    expect(veredito).toContain(COM_MOTIVO);
    expect(veredito).not.toContain("número sem hash não é oficial");
  });
});

describe("task 4 (evolve-5): paridade de motivos em Resumo/Pivô/Série", () => {
  const HASH_REASON = "sem hash auditado no manifest";
  it("/analisar Resumo semProva nomeia o hash (não bare)", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const resumo = secao(div.innerHTML, "Resumo filtrado");
    expect(resumo).toContain(SEM_DADO);
    expect(resumo).toContain(HASH_REASON);
  });
  it("/analisar Pivô semProva nomeia o hash (não bare via emptyStateFor)", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const pivo = secao(div.innerHTML, "Pivô");
    expect(pivo).toContain(SEM_DADO);
    expect(pivo).toContain(HASH_REASON);
  });
  it("/analisar Série semProva nomeia o hash (não bare via emptyStateFor)", async () => {
    mockFetch(MANIFEST_INVALIDO);
    const div = await renderJsdom(<Analisar />);
    const serie = secao(div.innerHTML, "Série histórica");
    expect(serie).toContain(SEM_DADO);
    expect(serie).toContain(HASH_REASON);
  });
});
