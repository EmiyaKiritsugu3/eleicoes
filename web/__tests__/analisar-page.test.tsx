import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Analisar from "../app/analisar/page";

// SSR estático: useEffect não roda (sem fetch nem window), então a página
// renderiza o estado inicial — selo na variante "dado não auditado".
const html = renderToStaticMarkup(<Analisar />);

describe("analisar (SSR fail-closed)", () => {
  it("renders heading e controles com export bloqueado", () => {
    expect(html).toContain("SAD Eleições — analisar");
    expect(html).toContain("Exportar CSV");
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
  });
  it("input município desabilitado com hint visível", () => {
    expect(html).toContain("por município em breve — V1 agrega por UF");
  });
});

describe("fixture-never-official em /analisar (selo via getSealState)", () => {
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
    expect(seal.fixtureHash).toBe("f".repeat(64));
  });
});
