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

// 5 municípios (abaixo do piso n ≥ 30): correlação suprimida, não zerada.
function linhasPoucas(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      ibge: `350010${i}`,
      uf: "SP",
      nome: `Peq ${i}`,
      votos: [600, 400],
      total: 1000,
      abst: 0,
      demo: demo(10 + i),
    });
  }
  return rows;
}

describe("explorar (supressão vs sem cobertura)", () => {
  it("n < 30 com cobertura → nota de supressão (piso), não sem-cobertura", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasPoucas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(html).toContain("sem dado oficial");
    expect(html).toContain("suprimida");
    expect(html).toContain("piso n ≥ 30");
    expect(html).not.toContain("sem cobertura nos blocos");
  });
  it("cruzar fora dos blocos → nota sem-cobertura (não supressão)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, cruzar: "zz_var" }}
      />,
    );
    expect(html).toContain("sem dado oficial");
    expect(html).toContain("sem cobertura nos blocos");
    expect(html).not.toContain("suprimida");
  });
  it("ranking + perfil sem cobertura usam role=alert como as demais seções", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, quem: "zz-desconhecido", ver: ["ranking", "tabela"] }}
      />,
    );
    const alerts = html.match(/role="alert"/g) ?? [];
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("sem dado oficial");
  });
});

describe("explorar (ver fora do set)", () => {
  it("?q= com visão desconhecida → só seções conhecidas, sem crash", () => {
    const url = buildExplorarShareUrl(
      { ...SEL_VALIDA, ver: ["dispersao", "vista-fantasma"], foco: "" },
      "b".repeat(64),
    );
    const back = parseExplorarQuery(url.slice("/explorar".length));
    expect(back.ver).toEqual(["dispersao"]);
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={back}
      />,
    );
    expect(html).toContain("Dispersão");
    expect(html).not.toContain("vista-fantasma");
  });
  it("initial programático com visão desconhecida não renderiza seção fantasma", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["mapa", "bogus"] }}
      />,
    );
    expect(html).toContain("Mapa — vencedor por município");
    expect(html).not.toContain("bogus");
  });
});

describe("explorar (tabela honra o filtro onde)", () => {
  // 20 municípios com vitória de Lula + 20 com Lula em 2º lugar.
  function linhasMistas(): MunRow[] {
    const rows: MunRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        ibge: `355030${i}`,
        uf: "SP",
        nome: `Lula ${i}`,
        votos: [600, 400],
        total: 1000,
        abst: 0,
        demo: demo(10 + i),
      });
    }
    for (let i = 0; i < 20; i++) {
      rows.push({
        ibge: `350010${i}`,
        uf: "SP",
        nome: `Bol ${i}`,
        votos: [400, 600],
        total: 1000,
        abst: 0,
        demo: demo(10 + i),
      });
    }
    return rows;
  }
  function secaoTabela(html: string): string {
    return html.split('aria-label="Perfil de onde venceu"')[1] ?? "";
  }
  it("onde=venceu: tabela conta só o recorte (n = 20, não 40)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasMistas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["tabela"], onde: "venceu" }}
      />,
    );
    expect(secaoTabela(html)).toContain("n = 20 municípios");
  });
  it("onde=2º lugar: tabela não usa o fato inteiro (sem dado; Resultado tem n = 20)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasMistas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["tabela"], onde: "segundo" }}
      />,
    );
    expect(html).toContain("n = 20 municípios");
    expect(secaoTabela(html)).toContain("sem dado oficial");
    expect(secaoTabela(html)).not.toContain("n = 20 municípios");
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
