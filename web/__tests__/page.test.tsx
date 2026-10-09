import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import { HomeContent } from "../components/HomeContent";

// SSR estático: useEffect não roda (sem fetch), então a página renderiza
// o estado inicial — badges na variante "dado não auditado", seções vazias.
const html = renderToStaticMarkup(<Home />);

describe("filtro município (V1 agrega por UF)", () => {
  it("input município desabilitado com hint visível", () => {
    expect(html).toContain("por município em breve — V1 agrega por UF");
    expect(html).toMatch(/<input[^>]*\bdisabled\b[^>]*aria-label="município"|<input[^>]*aria-label="município"[^>]*\bdisabled\b/);
  });
});

describe("proveniência por seção (R1)", () => {
  it("cada seção com número tem badge (Resumo, UF, ranking, evolução)", () => {
    const count = (html.match(/dado não auditado/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

describe("badge de aviso", () => {
  it("warn com role=alert e estilo visual distinto", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("badge-warn");
    expect(html).toContain("#fff3cd");
  });
});

describe("fixture-never-official em / (selo via getSealState)", () => {
  it("sem dado buscado: nunca renderiza o selo oficial", () => {
    expect(html).not.toContain("fonte auditada");
    expect(html).not.toContain("fonte oficial");
  });
  it("manifest só-fixture: selo oficial nulo, fixture sinalizada", async () => {
    const { getSealState } = await import("../lib/data");
    const seal = getSealState({
      ingestions: [
        { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "f".repeat(64), fixture: true },
      ],
    });
    expect(seal.official).toBe(null);
    expect(seal.hasFixture).toBe(true);
  });
});

describe("candidate scope honesty — F1+F2 (busca por candidato é global no V1)", () => {
  it("shows global-candidate note in Resumo/UF when candidato set", async () => {
    const { NOTA_CANDIDATO_GLOBAL } = await import("../lib/data");
    expect(html).not.toContain(NOTA_CANDIDATO_GLOBAL);
    const htmlCand = renderToStaticMarkup(<HomeContent initialFiltros={{ candidato: "silva" }} />);
    expect(htmlCand).toContain('role="note"');
    expect(htmlCand).toContain(NOTA_CANDIDATO_GLOBAL);
  });
  it("shows no-ano-cargo-uf-coverage note in ranking when those filters set with candidato", async () => {
    const { NOTA_RANKING_SEM_COBERTURA } = await import("../lib/data");
    expect(html).not.toContain(NOTA_RANKING_SEM_COBERTURA);
    const htmlMix = renderToStaticMarkup(
      <HomeContent initialFiltros={{ candidato: "silva", ano: "2022", cargo: "presidente", uf: "SP" }} />,
    );
    expect(htmlMix).toContain('role="note"');
    expect(htmlMix).toContain(NOTA_RANKING_SEM_COBERTURA);
    const htmlAnoSemCand = renderToStaticMarkup(<HomeContent initialFiltros={{ ano: "2022" }} />);
    expect(htmlAnoSemCand).not.toContain(NOTA_RANKING_SEM_COBERTURA);
  });
});
