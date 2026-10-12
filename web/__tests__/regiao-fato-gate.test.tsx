// @vitest-environment jsdom
// EVOLVE-10 Task 1 (gate do fato na /regiao — LAST ungated surface): a
// página passa `fato=null` salvo `vereditoTemProva(seal)` (fixture+hash
// exibe, paridade Explorar); os ramos numéricos do PainelRegiao caem em
// SEM_DADO sem fato. Buracos travados: entry sem hash (dataset válido, selo
// vazio), ?fato= p/ dataset sem registro, rotação que remove a prova.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "react-dom/client";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import PainelRegiao from "../components/PainelRegiao";
import {
  SEM_DADO,
  focarRotacao,
  instalarFetchRoteado,
  montarRotacao,
} from "./helpers";

// eslint-disable-next-line prefer-const
let fatoParamAtual = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "fato" ? fatoParamAtual : null) }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const DS_SEM_REGISTRO = "fato_2022_2_governador";

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
  ],
};

// Entry válida MAS sem sha256: dataset resolve (fato é buscado), selo vazio.
const MANIFEST_SEM_HASH = {
  ingestions: [{ tipo: "fato_municipal", dataset: DS }],
};

const MANIFEST_OFICIAL = {
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: DS,
      sha256: "a".repeat(64),
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    },
  ],
};

// Seed legítimo: fixture:true COM hash 64-hex conta como prova (paridade
// `vereditoTemProva` com Explorar — sem falso-negativo).
const MANIFEST_FIXTURE = {
  ingestions: [
    { tipo: "fato_municipal", dataset: DS, sha256: "f".repeat(64), fixture: true },
  ],
};

// Selo do fato vazio MAS Censo atestado: a pop é fato-independente e segue
// renderizando sob o gate do fato (protege contra refactor que ponha a
// linha da pop atrás do portão do fato).
const MANIFEST_SEM_HASH_COM_CENSO = {
  ingestions: [{ tipo: "fato_municipal", dataset: DS }],
  artifacts: [
    {
      arquivo: "censo_municipios.json",
      sha256: "c".repeat(64),
      source_url: "https://cdn.ibge.gov.br/censo.zip",
    },
  ],
};

const CENSO = { "3550308": 12345, "3550309": 6789 };

const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };

let manifestAtual: unknown = MANIFEST_OFICIAL;
const chamadas: string[] = [];

function instalar() {
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    if (u.endsWith("/data/censo_municipios.json")) return { ok: true, json: async () => CENSO };
    if (u.includes("/data/fato_")) return { ok: true, json: async () => FATO };
    return { ok: false, json: async () => null };
  });
}

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<PaginaRegiao params={{ ibge: "3550308" }} />));
  return el!;
}

function resultado(html: string): string {
  return html.split(/<h2[^>]*>Resultado/)[1]?.split("<section")[0] ?? "";
}

function perfil(html: string): string {
  return html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  fatoParamAtual = "";
  manifestAtual = MANIFEST_OFICIAL;
});

describe("/regiao: fato sem prova é suprimido (EVOLVE-10 Task 1)", () => {
  it("mount com entry sem hash: Resultado + Perfil em SEM_DADO, sem número", async () => {
    manifestAtual = MANIFEST_SEM_HASH;
    instalar();
    const div = await montar();
    const html = div.innerHTML;
    expect(resultado(html)).toContain(SEM_DADO);
    expect(perfil(html)).toContain(SEM_DADO);
    expect(html).not.toContain("Cand A");
    expect(html).not.toContain("600");
  });

  it("?fato= p/ dataset sem registro: SEM_DADO, sem número do dataset alheio", async () => {
    manifestAtual = MANIFEST_OFICIAL;
    instalar();
    fatoParamAtual = DS_SEM_REGISTRO;
    const div = await montar();
    const html = div.innerHTML;
    expect(resultado(html)).toContain(SEM_DADO);
    expect(perfil(html)).toContain(SEM_DADO);
    expect(html).not.toContain("Cand A");
  });

  it("rotação que remove a prova (hash some): números somem, SEM_DADO entra", async () => {
    manifestAtual = MANIFEST_OFICIAL;
    instalar();
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    manifestAtual = MANIFEST_SEM_HASH;
    await focarRotacao();
    const html = div.innerHTML;
    expect(resultado(html)).toContain(SEM_DADO);
    expect(html).not.toContain("Cand A");
  });

  it("controle oficial: números intactos (sem falso-negativo)", async () => {
    manifestAtual = MANIFEST_OFICIAL;
    instalar();
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    expect(div.innerHTML).toContain("600");
    expect(div.innerHTML).toContain("fonte auditada");
  });

  it("controle fixture com hash válido: números intactos (paridade Explorar)", async () => {
    manifestAtual = MANIFEST_FIXTURE;
    instalar();
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    expect(div.innerHTML).toContain("600");
    expect(div.innerHTML).not.toContain("fonte auditada");
  });

  it("selo do fato vazio + Censo atestado: pop renderiza, votos suprimidos (independência)", async () => {
    manifestAtual = MANIFEST_SEM_HASH_COM_CENSO;
    instalar();
    const div = await montar();
    const html = div.innerHTML;
    expect(resultado(html)).toContain(SEM_DADO);
    expect(html).not.toContain("Cand A");
    expect(html).not.toContain("Votos do vencedor");
    const p = perfil(html);
    expect(p).toContain("População (Censo 2022)");
    expect(p).toContain("12.345"); // pop do artefato, nunca demo fixture
  });

  it("UF sem prova + Censo: agregado do mapa renderiza, Resultado em SEM_DADO", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={null} seal={SEAL_NULO} manifestChecked censo={CENSO} />,
    );
    const res = html.split(/<h2[^>]*>Resultado<\/h2>/)[1]?.split("<section")[0] ?? "";
    const p = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1]?.split("<section")[0] ?? "";
    expect(res).toContain(SEM_DADO);
    expect(html).not.toContain("Cand A");
    expect(p).toContain("População (Censo 2022)");
    expect(p).toContain("19.134"); // 12345+6789 do mapa, sem fato
  });
});
