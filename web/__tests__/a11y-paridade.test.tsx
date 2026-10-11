// EVOLVE-13 Task 6 (trava de paridade a11y-spots): canvas com role,
// live regions nas superfícies com estado assíncrono, SEM_DADO anunciado,
// e fontes únicas de `ALERTA_STYLE`/`finito`/tabela UF.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapaBrasil from "../components/MapaBrasil";
import Comparator from "../components/Comparator";
import Auditoria from "../app/auditoria/page";
import { HomeContent } from "../components/HomeContent";
import { UF_POR_PREFIXO_IBGE } from "../components/PainelRegiao";
import { finito } from "../lib/motor";
import { ALERTA_STYLE, SEM_DADO } from "../lib/textos";
import { tokens } from "../lib/tokens";
import {
  MANIFEST_INVALIDO,
  MANIFEST_OK,
  mockCanvas2d,
  mockFetchHome,
  mockPath2D,
  renderJsdom,
  teardownJsdom,
  topoQuadradoUnico,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(teardownJsdom);

describe("EVOLVE-13: canvas do mapa é imagem nomeada", () => {
  it("<canvas> com role=img + aria-label não-vazio", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => topoQuadradoUnico("São Paulo") })),
    );
    try {
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      const canvas = div.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas!.getAttribute("role")).toBe("img");
      expect((canvas!.getAttribute("aria-label") ?? "").trim()).not.toBe("");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});

describe("EVOLVE-13: live regions nas superfícies com estado", () => {
  it("Comparator anuncia o resultado (role=status)", () => {
    const html = renderToStaticMarkup(
      <Comparator left={{ titulo: "A", votos: 100 }} right={{ titulo: "B", votos: 60 }} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Diferença");
  });

  it("auditoria anuncia o carregamento uma vez (role=status único)", () => {
    // SSR: effects não rodam → checked=false → ramo "carregando manifest…".
    // Só a seção Ingestões é live (cubic R1: 2 status idênticos duplicam).
    const html = renderToStaticMarkup(<Auditoria />);
    expect(html).toContain("carregando manifest");
    expect(html.split('role="status"').length - 1).toBe(1);
  });
});

describe("EVOLVE-13: SEM_DADO da Home anunciado uma vez (cubic R1)", () => {
  it("sem prova → 1 alerta vivo (Resumo) + demais seções como texto comum", async () => {
    mockFetchHome(MANIFEST_INVALIDO, "ausente");
    const div = await renderJsdom(<HomeContent />);
    const alertas = [...div.querySelectorAll('[role="alert"]')].filter((el) =>
      (el.textContent ?? "").includes(SEM_DADO),
    );
    // Um alerta vivo basta p/ o estado sem-prova compartilhado; as demais
    // seções anunciam o mesmo estado como texto comum (sem 4× assertive).
    expect(alertas).toHaveLength(1);
    const ocorrencias = div.innerHTML.split(SEM_DADO).length - 1;
    expect(ocorrencias).toBeGreaterThanOrEqual(4);
  });

  it("vazio local com prova → a seção anuncia o próprio vazio (cubic R2)", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const div = await renderJsdom(<HomeContent initialFiltros={{ candidato: "zzz-inexistente" }} />);
    const alertas = [...div.querySelectorAll('[role="alert"]')].filter((el) =>
      (el.textContent ?? "").includes(SEM_DADO),
    );
    // Só o Ranking esvazia (filtro sem match, com prova); Resumo/Mapa/
    // Evolução têm números e o banner sem-prova não existe.
    expect(alertas).toHaveLength(1);
  });
});

describe("EVOLVE-13: valores pinados da fonte única (cubic R1: pina valores, unicidade estrutural em review)", () => {
  it("ALERTA_STYLE fonte única em lib/textos com o valor M4-web", () => {
    expect(ALERTA_STYLE).toEqual({
      background: "#fff3cd",
      border: "1px solid #b45309",
      fontWeight: "bold",
    });
  });

  it("finito fonte única em lib/motor com o mesmo contrato", () => {
    expect(finito(1)).toBe(true);
    expect(finito(NaN)).toBe(false);
    expect(finito("1")).toBe(false);
    expect(finito(null)).toBe(false);
    expect(finito(undefined)).toBe(false);
  });

  it("tabela UF fonte única no PainelRegiao (índice verificar importa daqui)", () => {
    expect(UF_POR_PREFIXO_IBGE["35"]).toBe("SP");
    expect(UF_POR_PREFIXO_IBGE["11"]).toBe("RO");
    expect(UF_POR_PREFIXO_IBGE["53"]).toBe("DF");
    expect(Object.keys(UF_POR_PREFIXO_IBGE)).toHaveLength(27);
  });
});

describe("onda-2 task 3: skeletons + fade-in na Home", () => {
  function fetchPendente() {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  }

  it("loading mostra Skeleton + status oculto (sem texto visível duplicado)", async () => {
    fetchPendente();
    const div = await renderJsdom(<HomeContent />);
    const statuses = [...div.querySelectorAll('[role="status"]')].filter((el) =>
      (el.textContent ?? "").includes("a carregar"),
    );
    expect(statuses).toHaveLength(4);
    expect(div.innerHTML).toContain("a carregar");
    for (const st of statuses) {
      expect(st.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("loading: seção visível (opacity 1) com Skeleton; resolvido: wrapper com fade", async () => {
    fetchPendente();
    const div = await renderJsdom(<HomeContent />);
    for (const rotulo of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const sec = div.querySelector(`section[aria-label="${rotulo}"]`) as HTMLElement | null;
      expect(sec).not.toBeNull();
      // O fade vive no wrapper do conteúdo resolvido — a seção fica
      // opacity 1 p/ Skeleton + h2 renderizarem visíveis no loading.
      expect(sec!.style.opacity).toBe("1");
      const st = sec!.querySelector('[role="status"]');
      expect(st).not.toBeNull();
      expect(st!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    await teardownJsdom();
    mockFetchHome(MANIFEST_OK, "ausente");
    const pronto = await renderJsdom(<HomeContent />);
    for (const rotulo of ["Resumo", "Mapa por UF", "Ranking de candidatos", "Evolução"]) {
      const sec = pronto.querySelector(`section[aria-label="${rotulo}"]`) as HTMLElement | null;
      expect(sec).not.toBeNull();
      expect(sec!.style.opacity).toBe("1");
      const fade = [...sec!.querySelectorAll("div")].find(
        (d) =>
          (d as HTMLElement).style.opacity === "1" &&
          (d as HTMLElement).style.transition.includes("250ms"),
      );
      expect(fade).not.toBeUndefined();
    }
  });

  it("reduced-motion desliga a transição do conteúdo resolvido (pós-effect)", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const mm = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("matchMedia", mm);
    const w = window as unknown as Record<string, unknown>;
    const prevMm = w["matchMedia"];
    w["matchMedia"] = mm;
    try {
      // renderJsdom drena effects via act: semMovimento já flipou p/ true.
      const reduzido = await renderJsdom(<HomeContent />);
      const sec = reduzido.querySelector(
        'section[aria-label="Resumo"]',
      ) as HTMLElement | null;
      expect(sec).not.toBeNull();
      expect(sec!.style.opacity).toBe("1");
      const fade = [...sec!.querySelectorAll("div")].find(
        (d) => (d as HTMLElement).style.opacity === "1",
      );
      expect(fade).not.toBeUndefined();
      expect((fade as HTMLElement).style.transition).toBe("none");
    } finally {
      vi.unstubAllGlobals();
      if (prevMm === undefined) delete w["matchMedia"];
      else w["matchMedia"] = prevMm;
    }
  });
});

describe("onda-1 task 5: tabelas e inputs editoriais", () => {
  it("inputs da Busca têm foco visível verde", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const div = await renderJsdom(<HomeContent />);
    const input = div.querySelector('input[aria-label="ano"]') as HTMLInputElement;
    input.focus();
    expect(input.style.outline).toContain("2px");
    expect(input.style.outline).toContain(tokens.cor.destaqueVerde);
  });
  it("números de tabela são tabulares (SSR basta)", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const div = await renderJsdom(<HomeContent />);
    expect(div.innerHTML).toContain("tabular-nums");
  });
});
