/** Onda consulta-herói: a Home é ferramenta de consulta (filtros primeiro),
 * o curado é exemplo/atalho (não destino). */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeContent } from "../components/HomeContent";
import Nav from "../components/Nav";
import Perguntas from "../app/perguntas/page";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("consulta-herói", () => {
  it("Home: H1 convida a consultar (não a ler resultados)", () => {
    const html = renderToStaticMarkup(<HomeContent />);
    expect(html).toContain("Consulte os resultados auditados");
    expect(html).not.toContain("SAD Eleições — resultados");
  });
  it("Home: Busca é a primeira seção (herói), antes do Resumo", () => {
    const html = renderToStaticMarkup(<HomeContent />);
    const iBusca = html.indexOf('aria-label="Busca"');
    const iResumo = html.indexOf('aria-label="Resumo"');
    expect(iBusca).toBeGreaterThan(-1);
    expect(iResumo).toBeGreaterThan(-1);
    expect(iBusca).toBeLessThan(iResumo);
  });
  it("Home: sem lista de 30 perguntas (curado mora em /perguntas)", () => {
    const html = renderToStaticMarkup(<HomeContent />);
    expect(html).not.toContain("Biblioteca curada — 30 perguntas");
    expect(html).toContain('href="/perguntas"');
  });
  it("Nav: Perguntas depois de Verificar (curado secundário)", () => {
    const html = renderToStaticMarkup(<Nav />);
    expect(html.indexOf('href="/verificar"')).toBeLessThan(
      html.indexOf('href="/perguntas"'),
    );
  });
  it("/perguntas: índice vira exemplos com atalho p/ consulta", () => {
    const html = renderToStaticMarkup(<Perguntas />);
    expect(html).toContain("Exemplos de consulta");
    expect(html).toContain('href="/analisar"');
  });
});
