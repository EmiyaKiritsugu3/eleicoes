// EVOLVE-11 Task 5 (CSV nas curadas, paridade Analisar/Explorar/Regiao):
// Verificar e Curada tinham share mas zero export. Botão "Exportar CSV"
// desabilitado sem `seal.official` (gate oficial); habilitado exporta os
// números do veredito com header de proveniência. Marcações via SSR;
// download real via clique jsdom (cubic R3).
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import {
  VerificarConteudo,
  verificarCsvRows,
  type Check,
} from "../app/verificar/Verificar";
import {
  CuradaConteudo,
  curadaCsvRows,
  type PerguntaCurada,
} from "../app/perguntas/Curada";
import { buildCsvExport } from "../lib/export";
import type { SealState } from "../lib/data";
import {
  CANDIDATOS_EXEMPLO as CANDIDATOS,
  clicarExportar,
  esperarBotaoExport,
  linhas40Municipio as linhas40,
  renderJsdom,
  teardownJsdom,
} from "./helpers";
import type { MunRow } from "../lib/motor";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = "d".repeat(64);
const SEAL_OK: SealState = {
  official: { hash: HASH, url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};
const SEAL_FIXTURE: SealState = { official: null, hasFixture: true, fixtureHash: "f".repeat(64) };
const SEAL_NULO: SealState = { official: null, hasFixture: false, fixtureHash: "" };

function fato() {
  const municipios: MunRow[] = linhas40();
  return { candidatos: CANDIDATOS, municipios };
}

afterEach(teardownJsdom);

const CHECK: Check = {
  slug: "sint-vencedor",
  frase: "Candidata Exemplo A venceu no Brasil",
  computacao: { tipo: "vencedor_regiao", params: { quem: "@vencedor", regiao: "BR" } },
  fontes: ["https://dadosabertos.tse.jus.br/"],
};

const PERGUNTA: PerguntaCurada = {
  slug: "sint-curada",
  titulo: "Quem venceu onde",
  blocos: { quem: "cand-a", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"] },
  texto_metodo: "método sintético",
};

describe("verificarCsvRows / curadaCsvRows (linhas do CSV das curadas)", () => {
  it("verificar: numero/valor/formato + slug/veredito por linha", () => {
    const rows = verificarCsvRows("sint-vencedor", "sustentado", [
      { rotulo: "Votos de A", valor: 1234, formato: "contagem" },
      { rotulo: "Margem", valor: 0.2, formato: "pct" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ numero: "Votos de A", valor: 1234 });
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
  });

  it("curada: resumo da resposta numa linha + proveniência", () => {
    const rows = curadaCsvRows({
      titulo: "Quem venceu onde", nMunicipios: 40, shareMedio: 0.55,
      rPearson: 0.1, rSpearman: 0.2, nPearson: 38, nSpearman: 38,
      pesoShare: "eleitorado", veredito: "padrão sustentado entre os estratos",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n_municipios: 40, n_pearson: 38, peso_share: "eleitorado" });
    expect(rows[0]).toMatchObject({ entradas: expect.stringContaining("Censo IBGE") });
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
  });
});

// Botão Exportar CSV nas 2 curadas (table-driven: 1 render por superfície,
// sem forkar o bloco de asserts — gate Sonar duplication).
const SUPERFICIES: {
  nome: string;
  comNumeros: (seal: SealState) => string;
  semNumeros: () => string[];
}[] = [
  {
    nome: "verificar",
    comNumeros: (seal) =>
      renderToStaticMarkup(
        React.createElement(VerificarConteudo, {
          check: CHECK, slug: CHECK.slug, checks: [], fato: fato(), seal, manifestChecked: true,
        }),
      ),
    semNumeros: () => [
      renderToStaticMarkup(
        React.createElement(VerificarConteudo, {
          check: CHECK, slug: CHECK.slug, checks: [], fato: fato(), seal: SEAL_NULO, manifestChecked: true,
        }),
      ),
      renderToStaticMarkup(
        React.createElement(VerificarConteudo, {
          check: null, slug: "sint-vencedor", checks: [], fato: fato(), seal: SEAL_OK, manifestChecked: true,
        }),
      ),
    ],
  },
  {
    nome: "curada",
    comNumeros: (seal) =>
      renderToStaticMarkup(
        React.createElement(CuradaConteudo, {
          pergunta: PERGUNTA, fato: fato(), seal, manifestChecked: true,
        }),
      ),
    semNumeros: () => [
      renderToStaticMarkup(
        React.createElement(CuradaConteudo, {
          pergunta: PERGUNTA, fato: fato(), seal: SEAL_NULO, manifestChecked: true,
        }),
      ),
    ],
  },
];

describe("curadas: botão Exportar CSV (EVOLVE-11 Task 5)", () => {
  for (const s of SUPERFICIES) {
    it(`${s.nome}: com selo oficial → habilitado`, () => {
      esperarBotaoExport(s.comNumeros(SEAL_OK), "habilitado");
    });
    it(`${s.nome}: fixture sem oficial → desabilitado (gate oficial)`, () => {
      esperarBotaoExport(s.comNumeros(SEAL_FIXTURE), "desabilitado");
    });
    it(`${s.nome}: sem números → ausente`, () => {
      for (const html of s.semNumeros()) esperarBotaoExport(html, "ausente");
    });
  }
});

describe("curadas: download do CSV via clique (cubic R3)", () => {
  it("verificar: CSV baixado com números do veredito + hash oficial", async () => {
    const csv = await clicarExportar(
      React.createElement(VerificarConteudo, {
        check: CHECK, slug: CHECK.slug, checks: [], fato: fato(), seal: SEAL_OK, manifestChecked: true,
      }),
    );
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
    expect(csv).toContain("sint-vencedor");
  });

  it("curada: CSV baixado com resumo + n amostral + hash oficial", async () => {
    const csv = await clicarExportar(
      React.createElement(CuradaConteudo, {
        pergunta: PERGUNTA, fato: fato(), seal: SEAL_OK, manifestChecked: true,
      }),
    );
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
    expect(csv).toContain("n_pearson");
  });
});
