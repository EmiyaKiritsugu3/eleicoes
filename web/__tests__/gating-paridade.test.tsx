// @vitest-environment jsdom
// EVOLVE-3 Task 4 (ruling a): Home (/ via HomeContent) e /analisar suprimem
// números como Explorar/Curada — manifest inválido → "sem dado oficial" nas
// 4 superfícies (paridade fail-closed), nunca número + banner.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { HomeContent } from "../components/HomeContent";
import Analisar from "../app/analisar/page";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import { CuradaConteudo } from "../app/perguntas/Curada";
import { getSealState } from "../lib/data";
import perguntas from "../data/perguntas.json";
import type { MunRow } from "../lib/motor";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SEM_DADO = "sem dado oficial";

const RESUMO = { total_votos: 3000, total_linhas: 3, anos: [2022], tabelas: [] };
const POR_UF = [
  { ano: 2022, cargo: "presidente", uf: "SP", votos: 2000 },
  { ano: 2022, cargo: "presidente", uf: "RJ", votos: 1000 },
];
const POR_CAND = [{ candidato_id: "a", nome_urna: "Cand A", partido: "PA", votos: 2500, financiamento: 5000 }];
// Manifest inválido: sem ingestão auditável → selo vazio (sem oficial, sem fixture).
const MANIFEST_INVALIDO = { ingestions: [] };
// Manifest só-fixture com hash válido: vereditoTemProva true → números
// seguem visíveis (sem selo oficial), paridade Explorar/Curada.
const MANIFEST_FIXTURE = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "f".repeat(64), date: "2026-01-01", fixture: true },
  ],
};
const MANIFEST_OK = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "a".repeat(64), date: "2026-01-01" },
  ],
};

function mockFetch(manifest: unknown) {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
    if (String(url).endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (String(url).endsWith("/data/por_uf.json")) return { ok: true, json: async () => POR_UF };
    if (String(url).endsWith("/data/por_candidato.json"))
      return { ok: true, json: async () => POR_CAND };
    if (String(url).endsWith("/data/manifest.json")) return { ok: true, json: async () => manifest };
    return { ok: false, json: async () => null };
  });
}

const fetchOriginal = globalThis.fetch;
let el: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

async function renderJsdom(node: React.ReactElement): Promise<HTMLDivElement> {
  el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el!);
    root.render(node);
  });
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
  return el!;
}

function secao(html: string, label: string): string {
  const m = html.match(new RegExp(`<section aria-label="${label}">([\\s\\S]*?)</section>`));
  return m ? m[1] : "";
}

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
  return {
    esc_sup: 5 + i * 0.5, esc_med: 30, esc_fund: 50, renda_media: 2000,
    pobres_pct: 20, idade_mediana: 35, urbanizacao: 80, pop: 10000, eleitores: 1000,
  };
}
const CANDIDATOS = [
  { id: "cand-a", nome: "Candidata Exemplo A", partido: "PA" },
  { id: "cand-b", nome: "Candidato Exemplo B", partido: "PB" },
];
function fato40() {
  const municipios: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const a = 500 + i * 10;
    municipios.push({
      ibge: `355030${i}`, uf: "SP", nome: `Município ${i}`,
      votos: [a, 1000 - a], total: 1000, abst: 50, demo: demo(i),
    });
  }
  return { candidatos: CANDIDATOS, municipios };
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
  it("Curada: selo vazio → Resultado SEM_DADO, sem r nem share", () => {
    const seal = getSealState(MANIFEST_INVALIDO);
    const p = perguntas.find((q) => q.slug === "estudo-voto-vencedor")!;
    const html = renderToStaticMarkup(
      <CuradaConteudo pergunta={p} fato={fato40()} seal={seal} manifestChecked />,
    );
    const resultado = html.split('aria-label="Resultado"')[1].split("<section")[0];
    expect(resultado).toContain(SEM_DADO);
    expect(resultado).not.toMatch(/r \(Pearson\) = -?\d/);
    expect(resultado).not.toMatch(/share médio[^%]*%/);
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
