import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExplorarConteudo,
  buildExplorarShareUrl,
  parseExplorarQuery,
  type ExplorarSelecao,
} from "../components/Explorar";
import type { MunRow } from "../lib/motor";

const CANDIDATOS = [
  { id: "lula", nome: "Lula", partido: "PT" },
  { id: "bol", nome: "Bolsonaro", partido: "PL" },
];

function demo(escSup: number) {
  return {
    esc_sup: escSup,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 1000,
  };
}

// 40 municípios, Lula vence todos; share de Lula cresce com esc_sup
// (correlação forte, n = 40 ≥ piso 30).
function linhasValidas(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const lula = 500 + i * 10;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Mun ${i}`,
      votos: [lula, 1000 - lula],
      total: 1000,
      abst: 0,
      demo: demo(5 + i * 0.5),
    });
  }
  return rows;
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

describe("explorar (combinação válida)", () => {
  it("Lula × onde venceu × escolaridade × dispersão renderiza r + n + selo", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(html).toMatch(/r\s*=/);
    expect(html).toContain("40");
    expect(html).toContain("fonte auditada");
    expect(html).toContain("dado de município, não de pessoa");
  });
});

describe("explorar (sem cobertura, fail-closed)", () => {
  it("candidato fora dos blocos -> sem dado oficial, sem tela branca", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, quem: "zz-desconhecido" }}
      />,
    );
    expect(html).toContain("sem dado oficial");
    expect(html).toMatch(/role="alert"/);
    expect(html.length).toBeGreaterThan(500);
  });
});

describe("explorar (foco + share)", () => {
  it("honra o foco vindo do painel da região (?foco=<ibge>)", () => {
    const rows = linhasValidas();
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: rows }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, foco: rows[0].ibge }}
      />,
    );
    expect(html).toContain(rows[0].ibge);
  });
  it("estado → URL compartilhável ?q= + hash (round-trip)", () => {
    const url = buildExplorarShareUrl({ ...SEL_VALIDA, foco: "" }, "a".repeat(64));
    expect(url.startsWith("/explorar?")).toBe(true);
    expect(url).toContain("q=");
    expect(url).toContain("hash=" + "a".repeat(64));
    const back = parseExplorarQuery(url.slice("/explorar".length));
    expect(back.quem).toBe("lula");
    expect(back.onde).toBe("venceu");
    expect(back.cruzar).toBe("esc_sup");
    expect(back.ver).toEqual(["dispersao"]);
  });
});
