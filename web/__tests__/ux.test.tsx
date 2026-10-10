// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import RootLayout from "../app/layout";
import PainelRegiao, { type FatoRegiao } from "../components/PainelRegiao";
import { HomeContent } from "../components/HomeContent";
import Analisar from "../app/analisar/page";
import ExplorarPage from "../app/explorar/page";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import Auditoria from "../app/auditoria/page";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import { CuradaConteudo, type PerguntaCurada } from "../app/perguntas/Curada";
import type { SealState } from "../lib/data";
import type { MunRow } from "../lib/motor";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (_k: string) => null }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SEM_DADO = "sem dado oficial";

const SEAL_OK: SealState = {
  official: { hash: "a".repeat(64), url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};

const CANDIDATOS = [
  { id: "lula", nome: "Lula", partido: "PT" },
  { id: "bol", nome: "Bolsonaro", partido: "PL" },
];

function demo(i: number) {
  return {
    esc_sup: 5 + i * 0.5,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000 + i * 10,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 1000,
  };
}

// 40 municípios, Lula vence todos; share cresce com esc_sup (n ≥ piso 30).
function linhasValidas(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const lula = 500 + i * 10;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Mun ${i}`,
      votos: [lula, 1000 - lula],
      total: 1000,
      abst: 0,
      demo: demo(i),
    });
  }
  return rows;
}

const FATO_NOMEADO: FatoRegiao = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    {
      ibge: "3550308",
      uf: "SP",
      nome: "São Paulo",
      votos: [600, 400],
      total: 1000,
      abst: null,
      demo: demo(0),
    },
  ],
};

const SEL_VALIDA: ExplorarSelecao = {
  quem: "lula",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao", "tabela", "ranking"],
  foco: "",
};

const PERGUNTA: PerguntaCurada = {
  slug: "t",
  titulo: "Título curado",
  blocos: { quem: "lula", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao", "tabela", "ranking"] },
  texto_metodo: "método",
};

function secao(html: string, label: string): string {
  const m = html.match(new RegExp(`<section aria-label="${label}">([\\s\\S]*?)</section>`));
  return m ? m[1] : "";
}

function conta(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// jsdom serializa style como `overflow-x: auto;` (com espaço); SSR como
// `overflow-x:auto`. Aceita ambos.
function contaOverflow(hay: string): number {
  return (hay.match(/overflow-x:\s*auto/g) ?? []).length;
}

// ---------- fixtures de fetch ----------

const RESUMO = { total_votos: 3000, total_linhas: 3, anos: [2022], tabelas: [] };
const POR_UF = [
  { ano: 2022, cargo: "presidente", uf: "SP", votos: 2000 },
  { ano: 2022, cargo: "presidente", uf: "RJ", votos: 1000 },
];
const POR_CAND = [{ candidato_id: "a", nome_urna: "Cand A", partido: "PA", votos: 2500 }];
const MANIFEST_OK = {
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: "fato_2022_1_presidente",
      sha256: "a".repeat(64),
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    },
  ],
};
const FATO_JSON = { candidatos: CANDIDATOS, municipios: linhasValidas() };

function mockFetchOk() {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
    if (String(url).endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (String(url).endsWith("/data/por_uf.json")) return { ok: true, json: async () => POR_UF };
    if (String(url).endsWith("/data/por_candidato.json"))
      return { ok: true, json: async () => POR_CAND };
    if (String(url).endsWith("/data/manifest.json")) return { ok: true, json: async () => MANIFEST_OK };
    if (String(url).includes("/data/fato_")) return { ok: true, json: async () => FATO_JSON };
    return { ok: false, json: async () => null };
  });
}

function mockFetchErro() {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
    ok: false,
    json: async () => null,
  }));
}

function mockFetchPendente() {
  (globalThis as Record<string, unknown>).fetch = vi.fn(
    () => new Promise(() => {}),
  );
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
  // Drena a cadeia de fetches sequenciais dos effects (resumo → por_uf →
  // por_candidato → manifest): cada await exige um ciclo de flush.
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
  return el!;
}

// ---------- testes ----------

describe("ux nav", () => {
  it("nav renderiza Explorar/Perguntas/Verificar", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>filho</p>
      </RootLayout>,
    );
    expect(html).toContain('href="/explorar"');
    expect(html).toContain("Explorar");
    expect(html).toContain('href="/perguntas"');
    expect(html).toContain("Perguntas");
    expect(html).toContain('href="/verificar"');
    expect(html).toContain("Verificar");
  });
});

describe("ux H1 legível", () => {
  it("H1 usa nome+UF com IBGE em <small>", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO_NOMEADO} seal={SEAL_OK} manifestChecked />,
    );
    expect(html).toContain("São Paulo (SP)");
    expect(html).toMatch(/<h1>[\s\S]*<small>[\s\S]*3550308[\s\S]*<\/small>[\s\S]*<\/h1>/);
  });
});

describe("ux loading honesto (fetch pendente)", () => {
  it("/ (HomeContent): fetch pendente -> a carregar com role=status, não SEM_DADO", () => {
    const html = renderToStaticMarkup(<HomeContent />);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/a carregar/i);
    for (const s of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const corpo = secao(html, s);
      expect(corpo).not.toBe("");
      expect(corpo).toContain('role="status"');
      expect(corpo).not.toContain(SEM_DADO);
    }
  });
  it("/analisar: fetch pendente -> a carregar, não SEM_DADO", () => {
    const html = renderToStaticMarkup(<Analisar />);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/a carregar/i);
    expect(html).not.toContain(SEM_DADO);
  });
  it("/explorar: fetch pendente -> a carregar, não SEM_DADO", async () => {
    mockFetchPendente();
    const div = await renderJsdom(<ExplorarPage />);
    const txt = div.innerHTML;
    expect(txt).toMatch(/a carregar/i);
    expect(div.querySelector('[role="status"]')).not.toBeNull();
    expect(txt).not.toContain(SEM_DADO);
  });
  it("/regiao: fetch pendente -> a carregar, não SEM_DADO", async () => {
    mockFetchPendente();
    const div = await renderJsdom(<PaginaRegiao params={{ ibge: "3550308" }} />);
    expect(div.innerHTML).toMatch(/a carregar/i);
    expect(div.querySelector('[role="status"]')).not.toBeNull();
    expect(div.innerHTML).not.toContain(SEM_DADO);
  });
});

describe("ux fetch com erro falha fechado (fetch_error_not_stuck_loading)", () => {
  it("/ (HomeContent): fetch com erro -> SEM_DADO, sem loading preso", async () => {
    mockFetchErro();
    const div = await renderJsdom(<HomeContent />);
    expect(div.innerHTML).toContain(SEM_DADO);
    expect(div.innerHTML).not.toMatch(/a carregar/i);
  });
  it("/analisar: fetch com erro -> SEM_DADO, sem loading preso", async () => {
    mockFetchErro();
    const div = await renderJsdom(<Analisar />);
    expect(div.innerHTML).toContain(SEM_DADO);
    expect(div.innerHTML).not.toMatch(/a carregar/i);
  });
  it("/explorar: fetch com erro -> SEM_DADO, sem loading preso", async () => {
    mockFetchErro();
    const div = await renderJsdom(<ExplorarPage />);
    expect(div.innerHTML).toContain(SEM_DADO);
    expect(div.innerHTML).not.toMatch(/a carregar/i);
  });
  it("/regiao: fetch com erro -> SEM_DADO, sem loading preso", async () => {
    mockFetchErro();
    const div = await renderJsdom(<PaginaRegiao params={{ ibge: "3550308" }} />);
    expect(div.innerHTML).toContain(SEM_DADO);
    expect(div.innerHTML).not.toMatch(/a carregar/i);
  });
});

describe("ux tabelas com wrapper scroll (mobile sem estouro)", () => {
  it("explorar (quintis/ranking/perfil): toda tabela em wrapper overflow-x", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    const nTab = conta(html, "<table");
    expect(nTab).toBeGreaterThanOrEqual(3);
    expect(contaOverflow(html)).toBeGreaterThanOrEqual(nTab);
  });
  it("curada (perfil/quintis/estratos/ranking): toda tabela em wrapper overflow-x", () => {
    const html = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    const nTab = conta(html, "<table");
    expect(nTab).toBeGreaterThanOrEqual(4);
    expect(contaOverflow(html)).toBeGreaterThanOrEqual(nTab);
  });
  it("/ (rankingUf/ranking/evolução): toda tabela em wrapper overflow-x", async () => {
    mockFetchOk();
    const div = await renderJsdom(<HomeContent />);
    const html = div.innerHTML;
    const nTab = conta(html, "<table");
    expect(nTab).toBeGreaterThanOrEqual(3);
    expect(contaOverflow(html)).toBeGreaterThanOrEqual(nTab);
  });
  it("/analisar (pivô/série): toda tabela em wrapper overflow-x", async () => {
    mockFetchOk();
    const div = await renderJsdom(<Analisar />);
    const html = div.innerHTML;
    const nTab = conta(html, "<table");
    expect(nTab).toBeGreaterThanOrEqual(2);
    expect(contaOverflow(html)).toBeGreaterThanOrEqual(nTab);
  });
  it("/auditoria (ingestões): tabela em wrapper overflow-x", async () => {
    mockFetchOk();
    const div = await renderJsdom(<Auditoria />);
    const html = div.innerHTML;
    expect(conta(html, "<table")).toBeGreaterThanOrEqual(1);
    expect(contaOverflow(html)).toBeGreaterThanOrEqual(conta(html, "<table"));
  });
});

describe("ux CopyShare copia + fallback", () => {
  it("copiar usa clipboard e confirma com role=status", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    const writeText = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const div = await renderJsdom(<CopyShare url="/analisar?hash=abc" />);
      const btn = div.querySelector("button");
      expect(btn).not.toBeNull();
      await act(async () => {
        btn!.click();
      });
      expect(writeText).toHaveBeenCalledWith("/analisar?hash=abc");
      const status = div.querySelector('[role="status"]');
      expect(status).not.toBeNull();
      expect(status!.textContent).toMatch(/copiad/i);
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
  it("sem clipboard: fallback com input selecionável + role=status", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const div = await renderJsdom(<CopyShare url="/explorar?q=xyz" />);
    const btn = div.querySelector("button");
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });
    const input = div.querySelector('input[value="/explorar?q=xyz"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(div.querySelector('[role="status"]')).not.toBeNull();
  });
  it("share spots usam CopyShare (analisar/explorar/regiao)", async () => {
    mockFetchOk();
    const divA = await renderJsdom(<Analisar />);
    expect(divA.innerHTML).toContain("Copiar link");
    await act(async () => {
      root?.unmount();
    });
    root = null;
    el?.remove();
    const fatoCheio = { candidatos: CANDIDATOS, municipios: linhasValidas() };
    const htmlR = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={fatoCheio} seal={SEAL_OK} manifestChecked />,
    );
    expect(htmlR).toContain("Copiar link");
  });
});
