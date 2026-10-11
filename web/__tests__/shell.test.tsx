import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../app/layout";
import Nav from "../components/Nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/analisar?ano=2022" }));

describe("shell editorial", () => {
  it("marca + tokens aplicados no layout", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>filho</p>
      </RootLayout>,
    );
    expect(html).toContain("SAD Eleições");
    expect(html).toContain("resultados auditados");
    expect(html).toContain("#FAF7F0");
    expect(html).toContain("Georgia");
  });
});

describe("nav com estado ativo", () => {
  it("marca só o link ativo com aria-current, ignorando query", () => {
    const html = renderToStaticMarkup(<Nav />);
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // query não quebra o match; os 7 links continuam presentes:
    for (const href of ["/", "/analisar", "/explorar", "/perguntas", "/verificar", "/metodologia", "/auditoria"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
