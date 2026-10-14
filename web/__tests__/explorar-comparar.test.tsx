import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplorarConteudo, type ExplorarSelecao } from "../components/Explorar";
import type { MunRow } from "../lib/motor";
import {
  CANDIDATOS_LULA as CANDIDATOS,
  demoLula,
  linhas40LulaVencedor,
  SEAL_EXEMPLO as SEAL_OK,
} from "./helpers";

function linhasB(): MunRow[] {
  // Mesmo demo, lula vence os 40 com outra inclinação + ruído → r distinto de A, Δr visível, n=40
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const a = 560 + i * 8 + (i % 2) * 30;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Mun ${i}`,
      votos: [a, 1000 - a],
      total: 1000,
      abst: 0,
      demo: demoLula(5 + i * 0.5),
    });
  }
  return rows;
}

const SEL: ExplorarSelecao = { quem: "lula", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"] };

describe("explorar comparar pleitos", () => {
  it("com 2 fatos rende r 2018 + r 2022 + Δr", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhas40LulaVencedor() }}
        fatoB={{ candidatos: CANDIDATOS, municipios: linhasB() }}
        fatoBLabel="2018"
        seal={SEAL_OK}
        initial={SEL}
      />,
    );
    expect(html).toContain("Comparar pleitos");
    expect(html).toMatch(/r 2018|2018.*r|r.*2018/);
    expect(html).toMatch(/Δr/);
  });

  it("com 1 fato rende SEM_DADO comparativo, nunca r solitário como comparação", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo fato={{ candidatos: CANDIDATOS, municipios: linhas40LulaVencedor() }} seal={SEAL_OK} initial={SEL} />,
    );
    expect(html).toContain("Comparar pleitos");
    expect(html).toContain("sem dado oficial");
    expect(html).toMatch(/segundo pleito sem fato auditado/);
  });
});
