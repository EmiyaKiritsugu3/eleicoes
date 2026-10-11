// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import RootLayout from "../app/layout";
import PainelRegiao, { type FatoRegiao } from "../components/PainelRegiao";
import { HomeContent } from "../components/HomeContent";
import Analisar from "../app/analisar/page";
import ExplorarPage from "../app/explorar/page";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import Auditoria from "../app/auditoria/page";
import Metodologia from "../app/metodologia/page";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import { VerificarConteudo, type Check } from "../app/verificar/Verificar";
import { CuradaConteudo, type PerguntaCurada } from "../app/perguntas/Curada";
import type { SealState } from "../lib/data";
import type { MunRow } from "../lib/motor";
import {
  SEM_DADO,
  MANIFEST_OK,
  responderBasico,
  renderJsdom,
  rerenderJsdom,
  teardownJsdom,
  secao,
  CANDIDATOS_LULA as CANDIDATOS,
  demoBase,
  municipios40Linear,
} from "./helpers";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (_k: string) => null }),
  usePathname: () => "/",
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SEAL_OK: SealState = {
  official: { hash: "a".repeat(64), url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};

function demo(i: number) {
  return demoBase(5 + i * 0.5, 2000 + i * 10);
}

// 40 municípios, Lula vence todos; share cresce com esc_sup (n ≥ piso 30).
function linhasValidas(): MunRow[] {
  return municipios40Linear({ nome: (i) => `Mun ${i}`, abst: 0, demo });
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

const CHECK_INVENTARIO: Check = {
  slug: "sint-vencedor",
  frase: "Candidata Exemplo venceu no Brasil",
  computacao: { tipo: "vencedor_regiao", params: { quem: "lula", regiao: "BR" } },
  fontes: ["https://dadosabertos.tse.jus.br/"],
};

function conta(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// jsdom serializa style como `overflow-x: auto;` (com espaço); SSR como
// `overflow-x:auto`. Aceita ambos.
function contaOverflow(hay: string): number {
  return (hay.match(/overflow-x:\s*auto/g) ?? []).length;
}

// ---------- a11y T4: helpers ----------

// Wrappers de scroll em markup SSR: todo div com overflow-x:auto precisa ser
// focável com nome (tabindex=0 + role=region + aria-label não-vazio).
function wrappersSemNomeSSR(html: string): string[] {
  const ruins: string[] = [];
  const re = /<div[^>]*style="[^"]*overflow-x:\s*auto[^"]*"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const ok =
      /tabindex="0"/i.test(tag) &&
      /role="region"/i.test(tag) &&
      /aria-label="[^"]*\S[^"]*"/.test(tag);
    if (!ok) ruins.push(tag.slice(0, 200));
  }
  return ruins;
}

// Mesmo contrato em DOM jsdom (páginas com fetch: Home/analisar/auditoria).
function wrappersSemNomeDom(container: HTMLElement): string[] {
  const ruins: string[] = [];
  container.querySelectorAll("div").forEach((d) => {
    const el = d as HTMLDivElement;
    if (el.style.overflowX !== "auto") return;
    const tab = el.getAttribute("tabindex");
    const role = el.getAttribute("role");
    const label = (el.getAttribute("aria-label") ?? "").trim();
    if (tab !== "0" || role !== "region" || label === "") {
      ruins.push(el.outerHTML.slice(0, 200));
    }
  });
  return ruins;
}

// ---------- fixtures de fetch ----------

const FATO_JSON = { candidatos: CANDIDATOS, municipios: linhasValidas() };

function mockFetchOk() {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) =>
    responderBasico(String(url), MANIFEST_OK, null, FATO_JSON),
  );
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

afterEach(teardownJsdom);

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
  it("/ (HomeContent): fetch pendente -> a carregar com role=status, não SEM_DADO", async () => {
    mockFetchPendente();
    const div = await renderJsdom(<HomeContent />);
    const html = div.innerHTML;
    expect(html).toMatch(/a carregar/i);
    expect(div.querySelector('[role="status"]')).not.toBeNull();
    for (const s of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const corpo = secao(html, s);
      expect(corpo).not.toBe("");
      expect(corpo).toContain('role="status"');
      expect(corpo).not.toContain(SEM_DADO);
    }
  });
  it("/analisar: fetch pendente -> a carregar, não SEM_DADO, sem share", async () => {
    mockFetchPendente();
    const div = await renderJsdom(<Analisar />);
    expect(div.innerHTML).toMatch(/a carregar/i);
    expect(div.querySelector('[role="status"]')).not.toBeNull();
    expect(div.innerHTML).not.toContain(SEM_DADO);
    // #6: share só após o manifest resolver (hash vazio não ancora ?hash=).
    expect(div.innerHTML).not.toContain("Copiar link");
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
  it("copiar usa clipboard (URL absoluta) e confirma com role=status", async () => {
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
      // #5: caminho relativo resolve contra o origin antes de copiar.
      const abs = `${window.location.origin}/analisar?hash=abc`;
      expect(writeText).toHaveBeenCalledWith(abs);
      expect(div.innerHTML).toContain(abs);
      const status = div.querySelector('[role="status"]');
      expect(status).not.toBeNull();
      expect(status!.textContent).toMatch(/copiad/i);
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
  it("sem clipboard: fallback com input selecionável (URL absoluta) + role=status", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const div = await renderJsdom(<CopyShare url="/explorar?q=xyz" />);
    const btn = div.querySelector("button");
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.click();
    });
    const abs = `${window.location.origin}/explorar?q=xyz`;
    const input = div.querySelector("input") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe(abs);
    expect(div.querySelector('[role="status"]')).not.toBeNull();
  });
  it("url nova reseta estado copiado (#4)", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    const writeText = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const div = await renderJsdom(<CopyShare url="/analisar?hash=aaa" />);
      await act(async () => {
        div.querySelector("button")!.click();
      });
      expect(div.querySelector('[role="status"]')).not.toBeNull();
      await rerenderJsdom(<CopyShare url="/analisar?hash=bbb" />);
      expect(div.querySelector('[role="status"]')).toBeNull();
      expect(div.innerHTML).toContain(`${window.location.origin}/analisar?hash=bbb`);
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
  it("writeText obsoleto não marca copiado da url nova", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    let resolver!: (_v: void) => void;
    const writeText = vi.fn(
      (_s: string) => new Promise<void>((res) => void (resolver = res)),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const div = await renderJsdom(<CopyShare url="/analisar?hash=aaa" />);
      let pendente!: Promise<void>;
      await act(async () => {
        pendente = (async () => {
          div.querySelector("button")!.click();
        })();
      });
      // URL muda com a escrita pendente; ao resolver, nada de "copiado".
      await rerenderJsdom(<CopyShare url="/analisar?hash=bbb" />);
      await act(async () => {
        resolver();
        await pendente;
      });
      expect(div.querySelector('[role="status"]')).toBeNull();
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
  it("share spots usam CopyShare (analisar/explorar/regiao/verificar/curada/home)", async () => {
    mockFetchOk();
    const divA = await renderJsdom(<Analisar />);
    expect(divA.innerHTML).toContain("Copiar link");
    await teardownJsdom();
    // #3: ExplorarConteudo com selo oficial expõe o botão de copiar.
    const divE = await renderJsdom(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(divE.innerHTML).toContain("Copiar link");
    await teardownJsdom();
    const fatoCheio = { candidatos: CANDIDATOS, municipios: linhasValidas() };
    const htmlR = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={fatoCheio} seal={SEAL_OK} manifestChecked />,
    );
    expect(htmlR).toContain("Copiar link");
    // EVOLVE-10 Task 3: Verificar + Curada no inventário (todos os spots atuais).
    const htmlV = renderToStaticMarkup(
      <VerificarConteudo
        check={CHECK_INVENTARIO}
        slug={CHECK_INVENTARIO.slug}
        checks={[CHECK_INVENTARIO]}
        fato={fatoCheio}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    expect(htmlV).toContain("Copiar link");
    const htmlC = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={fatoCheio}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    expect(htmlC).toContain("Copiar link");
    expect(htmlC).toContain("hash=");
    // EVOLVE-11 Task 3: Home no inventário (6º spot, âncora de proveniência).
    mockFetchOk();
    const divH = await renderJsdom(<HomeContent />);
    expect(divH.innerHTML).toContain("Copiar link");
    expect(divH.innerHTML).toContain("hash=");
  });
});

describe("ux a11y T4 nav com quebra em viewport estreita", () => {
  it("nav usa flex-wrap para não estourar em telemóvel", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>filho</p>
      </RootLayout>,
    );
    expect(html).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("ux a11y T4 wrappers de scroll focáveis com nome", () => {
  it("explorar (quintis/ranking/perfil): todo wrapper é region focável com nome", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(wrappersSemNomeSSR(html)).toEqual([]);
    expect(conta(html, 'role="region"')).toBeGreaterThanOrEqual(conta(html, "<table"));
  });
  it("curada (perfil/quintis/estratos/ranking): todo wrapper é region focável com nome", () => {
    const html = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    expect(wrappersSemNomeSSR(html)).toEqual([]);
    expect(conta(html, 'role="region"')).toBeGreaterThanOrEqual(conta(html, "<table"));
  });
  it("/ (HomeContent): todo wrapper é region focável com nome", async () => {
    mockFetchOk();
    const div = await renderJsdom(<HomeContent />);
    expect(wrappersSemNomeDom(div)).toEqual([]);
    expect(div.querySelectorAll('[role="region"]').length).toBeGreaterThanOrEqual(
      conta(div.innerHTML, "<table"),
    );
  });
  it("/analisar: todo wrapper é region focável com nome", async () => {
    mockFetchOk();
    const div = await renderJsdom(<Analisar />);
    expect(wrappersSemNomeDom(div)).toEqual([]);
    expect(div.querySelectorAll('[role="region"]').length).toBeGreaterThanOrEqual(
      conta(div.innerHTML, "<table"),
    );
  });
  it("/auditoria (ingestões + artifacts): todo wrapper é region focável com nome", async () => {
    mockFetchOk();
    const div = await renderJsdom(<Auditoria />);
    expect(wrappersSemNomeDom(div)).toEqual([]);
    expect(div.querySelectorAll('[role="region"]').length).toBeGreaterThanOrEqual(
      conta(div.innerHTML, "<table"),
    );
  });
});

describe("ux a11y T4 regiões de estado anunciadas", () => {
  it("loading usa live region (role=status ou output)", async () => {
    mockFetchPendente();
    const div = await renderJsdom(<HomeContent />);
    expect(div.querySelector('[role="status"], output')).not.toBeNull();
  });
  it("CopyShare confirma com live region (role=status ou output)", async () => {
    const { default: CopyShare } = await import("../components/CopyShare");
    const writeText = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const div = await renderJsdom(<CopyShare url="/analisar?hash=abc" />);
      await act(async () => {
        div.querySelector("button")!.click();
      });
      const live = div.querySelector('[role="status"], output');
      expect(live).not.toBeNull();
      expect(live!.textContent).toMatch(/copiad/i);
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
});

// ---------- EVOLVE-3 Task 5: copy pt-BR (strings only, zero data) ----------

const SEAL_SEM_HASH: SealState = { official: null, hasFixture: false, fixtureHash: "" };

// Uma linha sem eleitorado auditado -> fallback total (pesoFonte misto no motor).
function linhasPesoMisto(): MunRow[] {
  return linhasValidas().map((r, i) =>
    i === 0 ? { ...r, demo: { ...r.demo!, eleitores: null } } : r,
  );
}

function perfilDe(html: string): string {
  return html.split('aria-label="Perfil de onde venceu"')[1].split("<section")[0];
}

describe("copy pt-BR (EVOLVE-3 Task 5: rótulos, hash nomeado, baixar)", () => {
  it("explorar perfil: peso rotulado em pt-BR, sem valor cru do motor", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    const perfil = perfilDe(html);
    expect(perfil).toContain("eleitores (peso: eleitorado)");
    expect(perfil).not.toContain("(peso: eleitores)");
    expect(perfil).not.toContain("(peso: misto)");
  });
  it("explorar perfil misto: peso efetivo, sem rótulo 'eleitores' (nEleitores inclui fallback)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasPesoMisto() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    const perfil = perfilDe(html);
    expect(perfil).toContain("de peso efetivo (eleitorado, total ou população)");
    expect(perfil).not.toContain("eleitores (peso:");
    expect(perfil).not.toContain("(peso: misto)");
  });
  it("curada perfil: peso efetivo no modo misto, eleitores no puro", () => {
    const html = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    expect(perfilDe(html)).toContain("eleitores (peso: eleitorado)");
    const htmlMisto = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={{ candidatos: CANDIDATOS, municipios: linhasPesoMisto() }}
        seal={SEAL_OK}
        manifestChecked
      />,
    );
    expect(perfilDe(htmlMisto)).toContain("de peso efetivo (eleitorado, total ou população)");
    expect(perfilDe(htmlMisto)).not.toContain("eleitores (peso:");
    expect(perfilDe(htmlMisto)).not.toContain("(peso: misto)");
  });
  it("explorar perfil sem hash nomeia o hash (paridade Resultado/Mapa)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_SEM_HASH}
        initial={SEL_VALIDA}
      />,
    );
    expect(perfilDe(html)).toContain("sem dado oficial");
    expect(perfilDe(html)).toContain("sem hash auditado no manifest");
  });
  it("curada perfil sem hash nomeia o hash (paridade Resultado/Método)", () => {
    const html = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={PERGUNTA}
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_SEM_HASH}
        manifestChecked
      />,
    );
    expect(perfilDe(html)).toContain("sem dado oficial");
    expect(perfilDe(html)).toContain("sem hash auditado no manifest");
  });
  it("auditoria SSR: botão 'Baixar', hint em frase completa", () => {
    const html = renderToStaticMarkup(<Auditoria />);
    expect(html).toContain("Baixar manifest");
    expect(html).toContain("O download está bloqueado");
  });
  it("auditoria sem ingestão auditada: frase completa de bloqueio", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ingestions: [] }),
    }));
    const div = await renderJsdom(<Auditoria />);
    expect(div.innerHTML).toContain("O download está bloqueado");
  });
  it("auditoria amostra sintética: frase completa de permissão", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ingestions: [
          {
            source_url: "https://cdn.tse.jus.br/x.zip",
            sha256: "f".repeat(64),
            date: "2026-01-01",
            fixture: true,
          },
        ],
      }),
    }));
    const div = await renderJsdom(<Auditoria />);
    expect(div.innerHTML).toContain("O download está permitido");
  });
  it("metodologia: hash 64-hex + arquivos servidos, sem 'não-vazio' nem 'download'", () => {
    // metodologia/page.tsx não importa React (JSX automático do Next);
    // no vitest o runtime clássico resolve React via global.
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(<Metodologia />);
      expect(html).toContain("64 dígitos hexadecimais");
      expect(html).not.toContain("não-vazio");
      expect(html).not.toMatch(/download/i);
      expect(html).toContain("baixar");
      expect(html).toContain("arquivos servidos em");
      expect(html).not.toContain("arquivos para baixar");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
