// @vitest-environment jsdom
// EVOLVE-7 Task 6 follow-up (gap rotação × Censo): a /regiao exibe a pop do
// artefato `censo_municipios.json`, mas o PainelRegiao busca o Censo uma vez
// no mount — sem trigger vivo, a pop ia stale na rotação (e a página não
// tinha trigger algum: nem o fato recarregava no foco). Estes testes travam
// o contrato: rotação → fato + Censo refetchados sob o mesmo gate de selo;
// foco sem rotação → só o manifest barato é relido.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import {
  SEM_DADO,
  instalarFetchRoteado,
  contaChamadas,
  focarRotacao,
  montarRotacao,
} from "./helpers";

// eslint-disable-next-line prefer-const
let fatoParamAtual = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "fato" ? fatoParamAtual : null) }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const manifestComHash = (hash: string) => ({
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: DS,
      sha256: hash,
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    },
  ],
});
const MANIFEST_A = manifestComHash("a".repeat(64));
const MANIFEST_B = manifestComHash("b".repeat(64));
const MANIFEST_INVALIDO = { ingestions: [] };

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

const CENSO_A = { "3550308": 12345, "3550309": 6789 };
const CENSO_B = { "3550308": 99999, "3550309": 6789 };

// Roteador mutável: a rotação troca manifest/censo SEM remontar a página.
let manifestAtual: unknown = MANIFEST_A;
let censoAtual: unknown = CENSO_A;
const chamadas: string[] = [];

function instalarFetchMutavel() {
  manifestAtual = MANIFEST_A;
  censoAtual = CENSO_A;
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    if (u.endsWith("/data/censo_municipios.json")) return { ok: true, json: async () => censoAtual };
    if (u.includes("/data/fato_")) return { ok: true, json: async () => FATO };
    return { ok: false, json: async () => null };
  });
}

const conta = (sufixo: string): number => contaChamadas(chamadas, sufixo);
const focar = (): Promise<void> => focarRotacao();

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<PaginaRegiao params={{ ibge: "3550308" }} />));
  return el!;
}

function perfil(html: string): string {
  return html.split("<h2>Perfil do lugar</h2>")[1] ?? "";
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  fatoParamAtual = "";
});

describe("/regiao: rotação de manifest refetcha o Censo (sem pop stale)", () => {
  it("rotação do selo refetcha fato + Censo e troca a pop (sem stale)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(perfil(div.innerHTML)).toContain("12.345");
    manifestAtual = MANIFEST_B;
    censoAtual = CENSO_B;
    await focar();
    expect(perfil(div.innerHTML)).toContain("99.999");
    expect(perfil(div.innerHTML)).not.toContain("12.345");
    expect(conta("/data/censo_municipios.json")).toBe(2);
    expect(conta("/data/manifest.json")).toBe(2);
  });

  it("foco sem rotação não refaz o fetch pesado (só o manifest barato)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    void div;
    expect(conta("/data/censo_municipios.json")).toBe(1);
    expect(conta("/data/manifest.json")).toBe(1);
    await focar();
    expect(conta("/data/manifest.json")).toBe(2);
    expect(conta("/data/censo_municipios.json")).toBe(1);
    expect(conta(`/data/${DS}.json`)).toBe(1);
  });

  it("rotação p/ manifest inválido suprime votos mas mantém a pop do artefato (fato-independente)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    manifestAtual = MANIFEST_INVALIDO;
    await focar();
    // Fato caiu (fail-closed do gate, paridade com o mount)…
    expect(div.innerHTML).not.toContain("Cand A");
    expect(div.innerHTML).toContain(SEM_DADO);
    // …mas a pop segue do artefato do Censo (proveniência própria, Task 2).
    expect(perfil(div.innerHTML)).toContain("12.345");
  });
});
