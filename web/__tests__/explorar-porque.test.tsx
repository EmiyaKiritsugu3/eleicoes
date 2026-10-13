import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import type { MunRow } from "../lib/motor";
import {
  CANDIDATOS_LULA as CANDIDATOS,
  demoBase,
  municipios40Linear,
} from "./helpers";

function demo(escSup: number) {
  return demoBase(escSup, 2000);
}

function linhasValidas(): MunRow[] {
  return municipios40Linear({ nome: (i) => `Mun ${i}`, abst: 0, demo: (i) => demo(5 + i * 0.5) });
}

const SEAL_OK = {
  official: { hash: "a".repeat(64), url: "https://exemplo.tse.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};

const SEL_VALIDA: ExplorarSelecao = {
  quem: "lula",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao"],
};

describe("explorar por-que (estratos + veredito leigo)", () => {
  it("recorte válido rende tabelas por região/renda + veredito, com aviso não-causal", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(html).toContain("Por quê?");
    expect(html).toContain("Correlação por região");
    expect(html).toContain("Correlação por faixa de renda");
    expect(html).toMatch(/sustentado|misto|não sustentado/);
    expect(html).toMatch(/correlação não implica causa/i);
    expect(html).toContain("dado de município, não de pessoa");
  });

  it("n < 30 rende supressão honesta, nunca zero", () => {
    const poucas: MunRow[] = [];
    for (let i = 0; i < 5; i++) {
      poucas.push({
        ibge: `350010${i}`,
        uf: "SP",
        nome: `Peq ${i}`,
        votos: [600 + i * 10, 400 - i * 10],
        total: 1000,
        abst: 0,
        demo: demo(10 + i),
      });
    }
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={{ candidatos: CANDIDATOS, municipios: poucas }} seal={SEAL_OK} initial={SEL_VALIDA} />,
    );
    expect(html).toContain("Por quê?");
    expect(html).toContain("sem dado oficial");
  });
});
