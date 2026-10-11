// EVOLVE-11 Task 5 (CSV nas curadas, paridade Analisar/Explorar/Regiao):
// Verificar e Curada tinham share mas zero export. Botão "Exportar CSV"
// desabilitado sem `seal.official` (gate oficial); habilitado exporta os
// números do veredito com header de proveniência. Componentes puros:
// SSR estático basta.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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
  demoCurada as demo,
  linhas40Municipio as linhas40,
} from "./helpers";
import type { MunRow } from "../lib/motor";

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

function botoesExport(html: string): string[] {
  return html.match(/<button[^>]*>Exportar CSV<\/button>/g) ?? [];
}

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
      rPearson: 0.1, rSpearman: 0.2, veredito: "padrão sustentado entre os estratos",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n_municipios: 40 });
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
  });
});

describe("verificar: botão Exportar CSV (EVOLVE-11 Task 5)", () => {
  function html(seal: SealState, check: Check | null = CHECK): string {
    return renderToStaticMarkup(
      React.createElement(VerificarConteudo, {
        check, slug: "sint-vencedor", checks: [], fato: fato(), seal, manifestChecked: true,
      }),
    );
  }

  it("veredito + selo oficial: botão habilitado", () => {
    const btns = botoesExport(html(SEAL_OK));
    expect(btns.length).toBe(1);
    expect(btns[0]).not.toMatch(/\bdisabled\b/);
  });

  it("veredito fixture sem oficial: botão desabilitado (gate oficial)", () => {
    const btns = botoesExport(html(SEAL_FIXTURE));
    expect(btns.length).toBe(1);
    expect(btns[0]).toMatch(/\bdisabled\b/);
  });

  it("sem prova (selo nulo): sem botão (sem números p/ exportar)", () => {
    expect(botoesExport(html(SEAL_NULO)).length).toBe(0);
  });

  it("sugestão (check null): sem botão", () => {
    expect(botoesExport(html(SEAL_OK, null)).length).toBe(0);
  });
});

describe("curada: botão Exportar CSV (EVOLVE-11 Task 5)", () => {
  function html(seal: SealState): string {
    return renderToStaticMarkup(
      React.createElement(CuradaConteudo, {
        pergunta: PERGUNTA, fato: fato(), seal, manifestChecked: true,
      }),
    );
  }

  it("números + selo oficial: botão habilitado", () => {
    const btns = botoesExport(html(SEAL_OK));
    expect(btns.length).toBe(1);
    expect(btns[0]).not.toMatch(/\bdisabled\b/);
  });

  it("números fixture sem oficial: botão desabilitado (gate oficial)", () => {
    const btns = botoesExport(html(SEAL_FIXTURE));
    expect(btns.length).toBe(1);
    expect(btns[0]).toMatch(/\bdisabled\b/);
  });

  it("sem prova (selo nulo): sem botão", () => {
    expect(botoesExport(html(SEAL_NULO)).length).toBe(0);
  });
});
