// EVOLVE-11 Task 4 (CSV no /regiao, paridade Analisar/Explorar): o painel
// tinha share mas zero export. Botão "Exportar CSV" desabilitado sem
// `seal.official` (gate oficial); habilitado exporta votos do pleito com
// header de proveniência (pop do Censo fora — proveniência distinta).
// PainelRegiao é puro (sem effects): SSR estático basta.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PainelRegiao, { regiaoCsvRows } from "../components/PainelRegiao";
import { buildCsvExport } from "../lib/export";

const DS = "fato_2022_1_presidente";
const HASH = "a".repeat(64);

function demo() {
  return {
    esc_sup: 12, esc_med: 30, esc_fund: 50, renda_media: 2200, pobres_pct: 18,
    idade_mediana: 34, urbanizacao: 85, pop: 12000, eleitores: 10000,
  };
}

const FATO = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    { ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [600, 400], total: 1000, abst: 100, demo: demo() },
    { ibge: "3550309", uf: "SP", nome: "Mun 1", votos: [100, 700], total: 800, abst: 50, demo: demo() },
  ],
};

const SEAL_OFICIAL = {
  official: { hash: HASH, url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};
const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };
const SEAL_FIXTURE = { official: null, hasFixture: true, fixtureHash: "f".repeat(64) };

function botoesExport(html: string): string[] {
  return html.match(/<button[^>]*>Exportar CSV<\/button>/g) ?? [];
}

describe("regiaoCsvRows (linhas do CSV do /regiao)", () => {
  it("municipio: vencedor + votos + margem/participação cruas", () => {
    const rows = regiaoCsvRows("3550308", {
      vencedorNome: "Cand A", vencedorPartido: "PA", v1: 600, v2: 400,
      total: 1000, margem: 0.2, participacao: 0.1,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ regiao: "3550308", vencedor: "Cand A", votos_vencedor: 600 });
  });

  it("UF: inclui contagem de municípios", () => {
    const rows = regiaoCsvRows("SP", {
      vencedorNome: "Cand B", vencedorPartido: "PB", v1: 1100, v2: 700,
      total: 1800, margem: 0.222, participacao: null, nMun: 2,
    });
    expect(rows[0]).toMatchObject({ regiao: "SP", municipios: 2 });
  });

  it("CSV final carrega header de proveniência + hash oficial", () => {
    const csv = buildCsvExport(
      regiaoCsvRows("3550308", {
        vencedorNome: "Cand A", vencedorPartido: "PA", v1: 600, v2: 400,
        total: 1000, margem: 0.2, participacao: 0.1,
      }),
      SEAL_OFICIAL.official,
    );
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
    expect(csv).toContain(HASH);
    expect(csv).toContain("Cand A");
  });
});

describe("/regiao: botão Exportar CSV (EVOLVE-11 Task 4)", () => {
  it("município + selo oficial: botão habilitado", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked fatoDataset={DS} censo={null} />,
    );
    const btns = botoesExport(html);
    expect(btns.length).toBe(1);
    expect(btns[0]).not.toMatch(/\bdisabled\b/);
  });

  it("UF + selo oficial: botão habilitado", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={FATO} seal={SEAL_OFICIAL} manifestChecked fatoDataset={DS} censo={null} />,
    );
    const btns = botoesExport(html);
    expect(btns.length).toBe(1);
    expect(btns[0]).not.toMatch(/\bdisabled\b/);
  });

  it("sem fato: nenhum botão (nada do pleito p/ exportar)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={null} seal={SEAL_NULO} manifestChecked fatoDataset={DS} censo={null} />,
    );
    // Ramo sem-fato não exporta (sem números do pleito): zero botões.
    expect(botoesExport(html).length).toBe(0);
  });

  it("fato fixture sem oficial: botão desabilitado (gate oficial)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_FIXTURE} manifestChecked fatoDataset={DS} censo={null} />,
    );
    const btns = botoesExport(html);
    expect(btns.length).toBe(1);
    expect(btns[0]).toMatch(/\bdisabled\b/);
  });
});
