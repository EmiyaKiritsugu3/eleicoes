// @vitest-environment jsdom
// EVOLVE-9 Task 1 (RED): fallback UF + estado com-foco viram links
// `/regiao/<UF>`; filtro existente mantido como comportamento adicional.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { HomeContent } from "../components/HomeContent";
import {
  MANIFEST_OK,
  mockFetchHome,
  mockPath2D,
  mockCanvas2d,
  renderJsdom,
  teardownJsdom,
  secao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(teardownJsdom);

function secaoMapa(html: string): string {
  return secao(html, "Mapa por UF");
}

describe("EVOLVE-9 Task 1: links de região no fallback", () => {
  it("fallback UF: linhas viram links /regiao/<UF>", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const div = await renderJsdom(<HomeContent />);
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).toContain("Votos por UF");
    expect(mapa).toContain('href="/regiao/SP"');
    expect(mapa).toContain('href="/regiao/RJ"');
  });

  it("estado com-foco (canvas): banner expõe link /regiao/<UF> e mantém filtro + voltar", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderJsdom(<HomeContent initialFiltros={{ uf: "SP" }} />);
      const mapa = secaoMapa(div.innerHTML);
      expect(mapa).toContain("<canvas");
      expect(mapa).toContain('href="/regiao/SP"');
      // Filtro intacto: input uf mantém SP + botão voltar presente.
      const ufInput = div.querySelector(
        'section[aria-label="Busca"] input[aria-label="uf"]',
      ) as HTMLInputElement | null;
      expect(ufInput?.value).toBe("SP");
      expect(mapa).toContain("Voltar para todas as UFs");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});
