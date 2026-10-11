// EVOLVE-12 Task 6 (trava de paridade CSV-spots): as 6 superfícies com
// export — Home, Analisar, Explorar, Regiao, Verificar, Curada — expõem
// exatamente 1 botão "Exportar CSV" com gate oficial (habilitado com selo
// oficial, desabilitado com fixture, ausente sem números). E as linhas
// carregam `entradas` (fonte única ENTRADAS_CURADA) + sem dup ano/cargo/uf
// no Analisar.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeContent, homeCsvRows } from "../components/HomeContent";
import Analisar from "../app/analisar/page";
import { analisarCsvRows } from "../lib/export";
import {
  ExplorarConteudo,
  explorarCsvRows,
  type ExplorarSelecao,
} from "../components/Explorar";
import PainelRegiao from "../components/PainelRegiao";
import { VerificarConteudo, verificarCsvRows, type Check } from "../app/verificar/Verificar";
import { CuradaConteudo, curadaCsvRows, type PerguntaCurada } from "../app/perguntas/Curada";
import { buildCsvExport, ENTRADAS_CURADA, ENTRADAS_HOME } from "../lib/export";
import type { SealState } from "../lib/data";
import type { MunRow } from "../lib/motor";
import {
  CANDIDATOS_EXEMPLO as CANDIDATOS,
  MANIFEST_OK,
  demoCurada,
  esperarBotaoExport,
  mockFetchHome,
  renderJsdom,
  responderBasico,
  teardownJsdom,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = "a".repeat(64);
const SEAL_OK: SealState = {
  official: { hash: HASH, url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" },
  hasFixture: false,
  fixtureHash: "",
};
const SEAL_FIXTURE: SealState = { official: null, hasFixture: true, fixtureHash: "f".repeat(64) };

const FATO = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    { ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [600, 400], total: 1000, abst: 100, demo: demoCurada() },
    { ibge: "3550309", uf: "SP", nome: "Mun 1", votos: [100, 700], total: 800, abst: 50, demo: demoCurada() },
  ] as MunRow[],
};

const SEL: ExplorarSelecao = { quem: "A", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"], foco: "" };
const CHECK: Check = {
  slug: "sint-vencedor",
  frase: "Cand A venceu no Brasil",
  computacao: { tipo: "vencedor_regiao", params: { quem: "A", regiao: "BR" } },
  fontes: ["https://dadosabertos.tse.jus.br/"],
};
const PERGUNTA: PerguntaCurada = {
  slug: "sint-curada",
  titulo: "Quem venceu onde",
  blocos: { quem: "A", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"] },
  texto_metodo: "método sintético",
};

function mockFetchAnalisar() {
  (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) =>
    responderBasico(String(url), MANIFEST_OK, "ausente", null),
  );
}

afterEach(teardownJsdom);

describe("EVOLVE-12: coluna entradas (fonte única ENTRADAS_CURADA)", () => {
  it("homeCsvRows carrega entradas honestas + só f_* aplicados (sem f_candidato)", () => {
    const rows = homeCsvRows(
      [{ uf: "SP", votos: 2000 }, { uf: "RJ", votos: 1000 }],
      { ano: "2022", cargo: "presidente", uf: "", candidato: "lula" },
    );
    expect(rows).toHaveLength(2);
    // Ranking por UF não usa demografia do Censo nem filtra por candidato.
    expect(rows[0]).toMatchObject({ uf: "SP", votos: 2000, entradas: ENTRADAS_HOME });
    expect(rows[0]).toMatchObject({ f_ano: "2022", f_cargo: "presidente", f_uf: "" });
    expect(rows[0]).not.toHaveProperty("f_candidato");
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("entradas");
    expect(csv).toContain("agregado por UF");
  });

  it("csvEscape neutraliza fórmula com prefixo tab/CR (antes do quote)", () => {
    const csv = buildCsvExport(
      [{ uf: "SP", votos: 1, entradas: "\t=1+1" }, { uf: "RJ", votos: 2, entradas: "\r@x" }],
      SEAL_OK.official,
    );
    const lines = csv.split("\n");
    expect(lines[1]).toContain("'\t=1+1");
    expect(lines[2]).toContain("'\r@x");
  });

  it("explorarCsvRows carrega entradas (paridade Curada)", () => {
    const rows = explorarCsvRows(FATO.municipios, SEL, FATO.candidatos);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatchObject({ entradas: ENTRADAS_CURADA });
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("entradas");
  });

  it("verificarCsvRows carrega entradas (paridade Curada)", () => {
    const rows = verificarCsvRows("sint-vencedor", "sustentado", [
      { rotulo: "Votos", valor: 1000, formato: "contagem" },
    ]);
    expect(rows[0]).toMatchObject({ entradas: ENTRADAS_CURADA });
    const csv = buildCsvExport(rows, SEAL_OK.official);
    expect(csv.split("\n")[0]).toContain("entradas");
  });

  it("curadaCsvRows segue com entradas (fonte única, sem fork)", () => {
    const rows = curadaCsvRows({
      titulo: "T", nMunicipios: 2, shareMedio: 0.5, rPearson: null,
      rSpearman: null, nPearson: null, nSpearman: null, pesoShare: "e", veredito: "v",
    });
    expect(rows[0]).toMatchObject({ entradas: ENTRADAS_CURADA });
  });
});

describe("EVOLVE-12: Analisar sem dup ano/cargo/uf", () => {
  it("analisarCsvRows só tem f_* (sem colunas nuas duplicadas)", () => {
    const rows = analisarCsvRows(
      [{ rotulo: "SP", votos: 2000 }],
      "uf",
      { ano: "2022", cargo: "presidente", uf: "SP" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chave: "SP", votos: 2000, pivo: "uf" });
    expect(rows[0]).toMatchObject({ f_ano: "2022", f_cargo: "presidente", f_uf: "SP" });
    expect(rows[0]).not.toHaveProperty("ano");
    expect(rows[0]).not.toHaveProperty("cargo");
    expect(rows[0]).not.toHaveProperty("uf");
    const csv = buildCsvExport(rows, SEAL_OK.official);
    const header = csv.split("\n")[0].split(",");
    expect(header).toContain("f_ano");
    expect(header.filter((h) => h === "ano")).toEqual([]);
    expect(header.filter((h) => h === "cargo")).toEqual([]);
    expect(header.filter((h) => h === "uf")).toEqual([]);
  });
});

describe("EVOLVE-12: PainelRegiao pronto={manifestChecked} (hardening)", () => {
  it("loading (pronto=false) sem motivo prematuro; resolvido sem oficial com motivo", () => {
    const loading = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={{ official: null, hasFixture: false, fixtureHash: "" }} fatoDataset="fato_2022_1_presidente" censo={null} />,
    );
    // pronto omitido = default true → motivo aparece; com pronto={false} some.
    expect(loading).toContain("exportação bloqueada");
    const aindaCarregando = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={{ official: null, hasFixture: false, fixtureHash: "" }} manifestChecked={false} fatoDataset="fato_2022_1_presidente" censo={null} />,
    );
    expect(aindaCarregando).not.toContain("exportação bloqueada");
  });
});

describe("EVOLVE-12 Task 6: inventário CSV-spots (6 superfícies)", () => {
  it("purass: Explorar/Regiao/Verificar/Curada com oficial → 1 botão habilitado", () => {
    const htmlE = renderToStaticMarkup(
      <ExplorarConteudo fato={FATO} seal={SEAL_OK} initial={SEL} />,
    );
    esperarBotaoExport(htmlE, "habilitado");
    const htmlR = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OK} manifestChecked fatoDataset="fato_2022_1_presidente" censo={null} />,
    );
    esperarBotaoExport(htmlR, "habilitado");
    const htmlV = renderToStaticMarkup(
      <VerificarConteudo check={CHECK} slug={CHECK.slug} checks={[CHECK]} fato={FATO} seal={SEAL_OK} manifestChecked />,
    );
    esperarBotaoExport(htmlV, "habilitado");
    const htmlC = renderToStaticMarkup(
      <CuradaConteudo pergunta={PERGUNTA} fato={FATO} seal={SEAL_OK} manifestChecked />,
    );
    esperarBotaoExport(htmlC, "habilitado");
  });

  it("purass com fixture → desabilitado (gate oficial)", () => {
    const htmlE = renderToStaticMarkup(
      <ExplorarConteudo fato={FATO} seal={SEAL_FIXTURE} initial={SEL} />,
    );
    esperarBotaoExport(htmlE, "desabilitado");
    const htmlR = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_FIXTURE} manifestChecked fatoDataset="fato_2022_1_presidente" censo={null} />,
    );
    esperarBotaoExport(htmlR, "desabilitado");
  });

  it("Home com oficial (jsdom) → 1 botão habilitado; Analisar com oficial → 1 habilitado (6/6)", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const divH = await renderJsdom(<HomeContent />);
    const btnsH = [...divH.querySelectorAll("button")].filter((b) => b.textContent === "Exportar CSV");
    expect(btnsH.length).toBe(1);
    expect(btnsH[0].disabled).toBe(false);
    await teardownJsdom();

    mockFetchAnalisar();
    const divA = await renderJsdom(<Analisar />);
    const btnsA = [...divA.querySelectorAll("button")].filter((b) => b.textContent === "Exportar CSV");
    expect(btnsA.length).toBe(1);
    expect(btnsA[0].disabled).toBe(false);
  });
});
