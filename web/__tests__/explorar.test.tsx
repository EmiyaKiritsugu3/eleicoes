import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExplorarConteudo,
  aplicarOnde,
  buildExplorarShareUrl,
  parseExplorarQuery,
  type ExplorarSelecao,
} from "../components/Explorar";
import type { MunRow } from "../lib/motor";
import type { SealState } from "../lib/data";
import {
  CANDIDATOS_LULA as CANDIDATOS,
  demoBase,
  municipios40Linear,
} from "./helpers";

function demo(escSup: number) {
  return demoBase(escSup, 2000);
}

// 40 municípios, Lula vence todos; share de Lula cresce com esc_sup
// (correlação forte, n = 40 ≥ piso 30).
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

describe("explorar (EVOLVE-8 Task 5: copy share→percentual, peso intacto)", () => {
  // 3 visões (teto MAX_VISOES): dispersao + ranking + tabela — as 3
  // renderizam (4 visões estouram o teto e a 4ª nunca renderiza).
  const SEL_TUDO: ExplorarSelecao = {
    quem: "lula",
    onde: "venceu",
    cruzar: "esc_sup",
    ver: ["dispersao", "ranking", "tabela"],
    foco: "3550300",
  };
  it("render sem 'share': termo leigo consistente em todas as seções", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_TUDO}
      />,
    );
    expect(html).not.toMatch(/share/i);
    expect(html).toContain("Percentual médio de votos por quintil");
    expect(html).toContain("Top municípios por percentual de votos");
    expect(html).toContain("maior percentual de votos de");
    // tabela (3ª visão, dentro do teto): perfil + peso em pt-BR, sem share.
    expect(html).toContain("Médias ponderadas vs Brasil");
    expect(html).toContain("eleitores (peso: eleitorado)");
  });
});

describe("explorar (quintis em percentual, paridade com ranking/foco)", () => {
  it("mediaY 0-1 vira percentual ×100 + % (nunca fração crua)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["dispersao"] }}
      />,
    );
    const tabela = html.split("<caption>Percentual médio de votos por quintil")[1].split("</table>")[0];
    expect(tabela).toMatch(/\d+,\d%/); // pt-BR + % (ex. 60,0%)
    expect(tabela).not.toMatch(/>0,\d+</); // fração crua 0,456 nunca
    // Fecha o buraco fração-com-%: sem ×100 o fixture daria 0,5% (casa com
    // \d+,\d% e escapa de >0,\d+< por causa do % antes do <).
    expect(tabela).not.toMatch(/>0,\d+%/);
    // Pin exato do fixture determinístico (40 linhas lineares a=500+i*10):
    // fração não-escalada jamais produz estes valores.
    for (const v of ["53,5%", "61,5%", "69,5%", "77,5%", "85,5%"]) {
      expect(tabela).toContain(v);
    }
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
// Votos variam com i (Lula sempre à frente): a supressão vem do piso
// amostral, nunca de variância zero.
function linhasPoucas(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      ibge: `350010${i}`,
      uf: "SP",
      nome: `Peq ${i}`,
      votos: [600 + i * 10, 400 - i * 10],
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
    return html.split('aria-label="Perfil')[1] ?? "";
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
    expect(html).toContain("Mun 0 (3550300) — UF SP");
    expect(html).not.toContain("fora do fato municipal");
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

describe("explorar (dispersão: Pearson + Spearman + pontos)", () => {
  it("mostra Spearman junto de Pearson (nunca Pearson sozinho)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    expect(html).toContain("Pearson");
    expect(html).toContain("Spearman");
  });
  it("dispersão renderiza pontos por município + reta (não só r e quintis)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={SEL_VALIDA}
      />,
    );
    const dispersao = html.split('aria-label="Dispersão"')[1] ?? "";
    expect(dispersao).toContain("<circle");
    expect(dispersao).toContain("mínimos quadrados");
  });
});

describe("explorar (segundo lugar: perfil de vitória não se aplica)", () => {
  function linhasMistas2(): MunRow[] {
    const rows: MunRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        ibge: `355030${i}`, uf: "SP", nome: `Lula ${i}`,
        votos: [600, 400], total: 1000, abst: 0, demo: demo(10 + i),
      });
    }
    for (let i = 0; i < 20; i++) {
      rows.push({
        ibge: `350010${i}`, uf: "SP", nome: `Bol ${i}`,
        votos: [400, 600], total: 1000, abst: 0, demo: demo(10 + i),
      });
    }
    return rows;
  }
  it("onde=2º lugar: título honesto + nota explícita na tabela", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasMistas2() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["tabela"], onde: "segundo" }}
      />,
    );
    expect(html).toContain("2º lugar");
    expect(html).toContain("perfil de vitória não se aplica");
    expect(html).not.toContain("Perfil de onde Lula venceu");
  });
});

describe("explorar (participação = comparecimento auditado)", () => {
  it("usa (eleitorado − abstenções) ÷ eleitorado, não só votos nominais", () => {
    // Comparecimento 90% com só 50% de votos nominais: entra no recorte.
    const rows: MunRow[] = [{
      ibge: "3550300", uf: "SP", nome: "Mun 0",
      votos: [300, 200], total: 500, abst: 100, demo: demo(10),
    }];
    expect(aplicarOnde(rows, CANDIDATOS, "lula", "participacao_80")).toHaveLength(1);
  });
  it("sem abstenções auditadas: recorre a votos nominais ÷ eleitorado", () => {
    const dentro: MunRow[] = [{
      ibge: "3550300", uf: "SP", nome: "Mun 0",
      votos: [850, 100], total: 950, abst: null, demo: demo(10),
    }];
    const fora: MunRow[] = [{
      ibge: "3550301", uf: "SP", nome: "Mun 1",
      votos: [300, 200], total: 500, abst: null, demo: demo(10),
    }];
    expect(aplicarOnde(dentro, CANDIDATOS, "lula", "participacao_80")).toHaveLength(1);
    expect(aplicarOnde(fora, CANDIDATOS, "lula", "participacao_80")).toHaveLength(0);
  });
});

const SEAL_SEM_HASH = { official: null, hasFixture: false, fixtureHash: "" };
const SEAL_HASH_VAZIO = { official: { hash: "", url: "", date: "" }, hasFixture: false, fixtureHash: "" };
const SEAL_FIXTURE = { official: null, hasFixture: true, fixtureHash: "c".repeat(64) };

function htmlExplorar(fato: { candidatos: typeof CANDIDATOS; municipios: MunRow[] }, seal: SealState) {
  return renderToStaticMarkup(
    <ExplorarConteudo fato={fato} seal={seal} initial={SEL_VALIDA} />,
  );
}

function secaoResultado(html: string): string {
  return html.split('aria-label="Resultado"')[1].split("<section")[0];
}

describe("explorar (gate de hash: fato sem hash não sustenta número)", () => {
  it("fato presente sem hash → Resultado SEM_DADO, sem r", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_SEM_HASH);
    expect(secaoResultado(html)).toContain("sem dado oficial");
    expect(secaoResultado(html)).not.toMatch(/r \(Pearson\) = -?\d/);
  });
  it("fato presente sem hash → Dispersão sem r, só SEM_DADO", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_SEM_HASH);
    const dispersao = html.split('aria-label="Dispersão"')[1].split("<section")[0];
    expect(dispersao).toContain("sem dado oficial");
    expect(dispersao).not.toMatch(/r \(Pearson\) = -?\d/);
  });
  it("selo fixture com hash segue sustentando números (paridade com Verificar)", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_FIXTURE);
    expect(secaoResultado(html)).toMatch(/r \(Pearson\) = -?\d/);
  });
  it("official com hash vazio → SEM_DADO, sem r (paridade com Verificar)", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_HASH_VAZIO);
    expect(secaoResultado(html)).toContain("sem dado oficial");
    expect(secaoResultado(html)).not.toMatch(/r \(Pearson\) = -?\d/);
  });
  it("mapa sem hash → SEM_DADO, sem canvas nem fallback (vencedores suprimidos)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_SEM_HASH}
        initial={{ ...SEL_VALIDA, ver: ["mapa"] }}
      />,
    );
    const mapa = html.split('aria-label="Mapa"')[1].split("<section")[0];
    expect(mapa).toContain("sem dado oficial");
    expect(mapa).not.toContain("<canvas");
    expect(mapa).not.toContain("Mapa indisponível neste navegador");
  });
  it("mapa com hash segue renderizando (sem regressão)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, ver: ["mapa"] }}
      />,
    );
    const mapa = html.split('aria-label="Mapa"')[1].split("<section")[0];
    expect(mapa).not.toContain("sem dado oficial");
  });
  it("Dispersão sem hash nomeia o hash (não 'sem cobertura nos blocos')", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_SEM_HASH);
    const dispersao = html.split('aria-label="Dispersão"')[1].split("<section")[0];
    expect(dispersao).toContain("sem dado oficial");
    expect(dispersao).toContain("sem hash auditado no manifest");
    expect(dispersao).not.toContain("sem cobertura nos blocos");
  });
  it("Ranking sem hash nomeia o hash (não 'sem cobertura neste recorte')", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_SEM_HASH}
        initial={{ ...SEL_VALIDA, ver: ["ranking"] }}
      />,
    );
    const ranking = html.split('aria-label="Ranking"')[1].split("<section")[0];
    expect(ranking).toContain("sem dado oficial");
    expect(ranking).toContain("sem hash auditado no manifest");
    expect(ranking).not.toContain("sem cobertura neste recorte");
  });
  it("Dispersão sem cobertura COM hash mantém motivo de cobertura (sem regressão)", () => {
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhasValidas() }}
        seal={SEAL_OK}
        initial={{ ...SEL_VALIDA, quem: "" }}
      />,
    );
    const dispersao = html.split('aria-label="Dispersão"')[1].split("<section")[0];
    expect(dispersao).toContain("sem cobertura nos blocos");
    expect(dispersao).not.toContain("sem hash auditado");
  });
});

describe("explorar (decimais pt-BR: vírgula, nunca ponto)", () => {
  it("r (Pearson/Spearman) renderiza com vírgula", () => {
    const html = htmlExplorar({ candidatos: CANDIDATOS, municipios: linhasValidas() }, SEAL_OK);
    expect(html).toMatch(/r \(Pearson\) = -?\d+,\d{3}/);
    expect(html).not.toMatch(/r \(Pearson\) = -?\d+\.\d{3}/);
    expect(html).not.toMatch(/r \(Spearman\) = -?\d+\.\d{3}/);
  });
});
