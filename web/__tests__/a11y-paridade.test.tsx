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
import {
  MANIFEST_INVALIDO,
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

  it("auditoria anuncia o carregamento (role=status)", () => {
    // SSR: effects não rodam → checked=false → ramo "carregando manifest…".
    const html = renderToStaticMarkup(<Auditoria />);
    expect(html).toContain('role="status"');
    expect(html).toContain("carregando manifest");
  });
});

describe("EVOLVE-13: SEM_DADO da Home é alerta anunciado", () => {
  it("sem prova → SEM_DADO com role=alert nas seções de dados", async () => {
    mockFetchHome(MANIFEST_INVALIDO, "ausente");
    const div = await renderJsdom(<HomeContent />);
    const alertas = [...div.querySelectorAll('[role="alert"]')].filter((el) =>
      (el.textContent ?? "").includes(SEM_DADO),
    );
    // Resumo + Mapa + Ranking + Evolução (fail-closed sem prova).
    expect(alertas.length).toBeGreaterThanOrEqual(4);
  });
});

describe("EVOLVE-13: fontes únicas (dedupe)", () => {
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
