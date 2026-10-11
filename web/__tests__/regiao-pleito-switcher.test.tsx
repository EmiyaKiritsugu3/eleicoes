// @vitest-environment jsdom
// EVOLVE-11 Task 1 (pleito switcher UI na /regiao): `?fato=` hoje só via URL.
// A página lista os pleitos do manifest num `<select aria-label="pleito">`
// (navegação GET nativa, sem router) — fail-closed: `?fato=` inválido cai no
// default, nunca monta fetch arbitrário.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import { listarFatosMunicipais } from "../lib/regiao";
import {
  demoCurada,
  instalarFetchRoteado,
  montarRotacao,
} from "./helpers";

// eslint-disable-next-line prefer-const
let fatoParamAtual = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "fato" ? fatoParamAtual : null) }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS_A = "fato_2022_1_presidente";
const DS_B = "fato_2022_2_governador";
// Bem-formado (passa no allowlist) mas sem registro no manifest.
const DS_SEM_REGISTRO = "fato_2020_1_presidente";

// FATO mínimo p/ o fetch roteado (demo via `demoCurada` de ./helpers).
const FATO = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    { ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [600, 400], total: 1000, abst: 100, demo: demoCurada() },
  ],
};

const MANIFEST_DOIS = {
  ingestions: [
    { tipo: "fato_municipal", dataset: DS_A, sha256: "a".repeat(64), source_url: "https://cdn.tse.jus.br/a.zip", date: "2026-01-01" },
    { tipo: "fato_municipal", dataset: DS_B, sha256: "b".repeat(64), source_url: "https://cdn.tse.jus.br/b.zip", date: "2026-01-01" },
  ],
};

const MANIFEST_UM = {
  ingestions: [
    { tipo: "fato_municipal", dataset: DS_A, sha256: "a".repeat(64), source_url: "https://cdn.tse.jus.br/a.zip", date: "2026-01-01" },
  ],
};

const CENSO = { "3550308": 12345 };

let manifestAtual: unknown = MANIFEST_DOIS;
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

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  fatoParamAtual = "";
  manifestAtual = MANIFEST_DOIS;
});

describe("listarFatosMunicipais (fonte única das opções)", () => {
  it("lista datasets fato_municipal válidos em ordem, sem duplicar", () => {
    expect(listarFatosMunicipais(MANIFEST_DOIS)).toEqual([DS_A, DS_B]);
  });

  it("rejeita traversal e shape fora do allowlist, ignora outro tipo", () => {
    const m = {
      ingestions: [
        { tipo: "fato_municipal", dataset: DS_A },
        { tipo: "fato_municipal", dataset: "fato_../x" },
        { tipo: "fato_municipal", dataset: "fato_2022" },
        { tipo: "outro_tipo", dataset: DS_B },
        { tipo: "fato_municipal", dataset: DS_A },
      ],
    };
    expect(listarFatosMunicipais(m)).toEqual([DS_A]);
  });

  it("sem manifest ou sem ingestions → []", () => {
    expect(listarFatosMunicipais(null)).toEqual([]);
    expect(listarFatosMunicipais({})).toEqual([]);
    expect(listarFatosMunicipais({ ingestions: [] })).toEqual([]);
  });
});

describe("/regiao: pleito switcher (EVOLVE-11 Task 1)", () => {
  it("dois pleitos: select lista ambos e marca o atual (?fato=)", async () => {
    fatoParamAtual = DS_B;
    instalar();
    const div = await montar();
    const sel = div.querySelector('select[aria-label="pleito"]') as HTMLSelectElement | null;
    expect(sel).not.toBe(null);
    const vals = [...(sel?.querySelectorAll("option") ?? [])].map((o) => (o as HTMLOptionElement).value);
    expect(vals).toContain(DS_A);
    expect(vals).toContain(DS_B);
    expect(sel?.value).toBe(DS_B);
  });

  it("um pleito só: sem select (sem ruído)", async () => {
    manifestAtual = MANIFEST_UM;
    instalar();
    const div = await montar();
    expect(div.querySelector('select[aria-label="pleito"]')).toBe(null);
  });

  it("?fato= inválido: select marca o default e nenhum fetch com traversal (cubic R3)", async () => {
    fatoParamAtual = "fato_../etc-passwd";
    instalar();
    const div = await montar();
    const sel = div.querySelector('select[aria-label="pleito"]') as HTMLSelectElement | null;
    expect(sel).not.toBe(null);
    expect(sel?.value).toBe(DS_A);
    // Override malformado cai no default: o único fato buscado é o default.
    expect(chamadas.filter((c) => c.includes("/data/fato_"))).toEqual([`/data/${DS_A}.json`]);
    expect(chamadas.some((c) => c.includes(".."))).toBe(false);
  });

  it("?fato= bem-formado mas sem registro: select exibe o default (cubic R3)", async () => {
    fatoParamAtual = DS_SEM_REGISTRO;
    instalar();
    const div = await montar();
    const sel = div.querySelector('select[aria-label="pleito"]') as HTMLSelectElement | null;
    expect(sel).not.toBe(null);
    expect(sel?.value).toBe(DS_A);
    // Fail-closed preservado: sem registro, sem números do dataset alheio
    // (o fetch do override bem-formado volta com selo vazio → suprimido).
    expect(div.innerHTML).toContain("sem dado oficial");
    expect(div.innerHTML).not.toContain("Cand A");
    const chamadasFato = chamadas.filter((c) => c.includes("/data/fato_"));
    expect(chamadasFato).toEqual([`/data/${DS_SEM_REGISTRO}.json`]);
    expect(chamadas.some((c) => c.includes(".."))).toBe(false);
  });
});
