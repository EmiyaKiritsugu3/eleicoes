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
  flushRotacao,
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
// Entry `artifacts` do Censo (EVOLVE-8 Task 1): sem ela a pop cai p/
// SEM_DADO mesmo com fato auditado — os manifests de controle a carregam
// (fluxo legítimo pinado); o caso sem entry é o teste do selo abaixo.
const CENSO_ENTRY = {
  arquivo: "censo_municipios.json",
  sha256: "c".repeat(64),
  source_url: "https://cdn.ibge.gov.br/censo.zip",
};
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
  artifacts: [CENSO_ENTRY],
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
    expect(conta(`/data/${DS}.json`)).toBe(2); // fato refetchado junto (sem número stale)
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

  it("rotação p/ manifest sem entry do Censo suprime pop E votos (fail-closed total)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    expect(perfil(div.innerHTML)).toContain("12.345");
    manifestAtual = MANIFEST_INVALIDO;
    await focar();
    // Fato caiu (fail-closed do gate, paridade com o mount)…
    expect(div.innerHTML).not.toContain("Cand A");
    expect(div.innerHTML).toContain(SEM_DADO);
    // …e a pop cai junto (EVOLVE-8 Task 1): sem entry `artifacts` do
    // Censo, o artefato não sustenta número — JSON forjado/órfão no path
    // servido nunca renderiza, mesmo fato-independente.
    const linha = (perfil(div.innerHTML).split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    expect(perfil(div.innerHTML)).not.toContain("12.345");
  });

  it("Censo lento não esconde o fato atrás do loader (carga independente)", async () => {
    let liberaCenso: (() => void) | null = null;
    const censoLento = new Promise<unknown>((res) => {
      liberaCenso = () => res({ ok: true, json: async () => CENSO_A });
    });
    manifestAtual = MANIFEST_A;
    instalarFetchRoteado(chamadas, (u) => {
      if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
      if (u.endsWith("/data/censo_municipios.json")) return censoLento;
      if (u.includes("/data/fato_")) return { ok: true, json: async () => FATO };
      return { ok: false, json: async () => null };
    });
    const div = await montar();
    // Painel já renderiza com o fato assentado, sem loader de página…
    expect(div.innerHTML).toContain("Cand A");
    expect(div.querySelector('[role="status"]')).toBeNull();
    // …e a pop entra quando o Censo assenta (SEM_DADO transitório, sem throw).
    expect(perfil(div.innerHTML)).toContain(SEM_DADO);
    await act(async () => {
      liberaCenso!();
    });
    await flushRotacao();
    expect(perfil(div.innerHTML)).toContain("12.345");
  });

  it("run stale nunca publica sobre estado mais novo (token de geração)", async () => {
    const DSA = "fato_2022_1_presidente";
    const DSB = "fato_2022_2_presidente";
    const ing = (dataset: string, hash: string) => ({
      tipo: "fato_municipal", dataset, sha256: hash,
      source_url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01",
    });
    const comCenso = (ings: unknown[]) => ({ ingestions: ings, artifacts: [CENSO_ENTRY] });
    const M1 = comCenso([ing(DSA, "a".repeat(64))]);
    const M2 = comCenso([ing(DSA, "b".repeat(64)), ing(DSB, "c".repeat(64))]);
    const M3 = comCenso([ing(DSA, "d".repeat(64)), ing(DSB, "e".repeat(64))]);
    const FATO_B = {
      candidatos: [
        { id: "C", nome: "Cand C", partido: "PC" },
        { id: "D", nome: "Cand D", partido: "PD" },
      ],
      municipios: [
        { ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [700, 300], total: 1000, abst: 100, demo: demo() },
      ],
    };
    manifestAtual = M1;
    // Trava manual por URL: fetches travados pendem até liberação explícita.
    const pendentes = new Map<string, () => void>();
    let travar = new Set<string>();
    const carga = (u: string) => (u.endsWith(`/${DSB}.json`) ? FATO_B : FATO);
    instalarFetchRoteado(chamadas, (u) => {
      if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
      if (u.endsWith("/data/censo_municipios.json")) return { ok: true, json: async () => CENSO_A };
      if (u.includes("/data/fato_")) {
        if (travar.has(u)) {
          return new Promise((res) => {
            pendentes.set(u, () => res({ ok: true, json: async () => carga(u) }));
          });
        }
        return { ok: true, json: async () => carga(u) };
      }
      return { ok: false, json: async () => null };
    });
    const div = await montar();
    expect(div.innerHTML).toContain("Cand A");
    // R1 (rotação p/ M2) prende o fato DSA em voo…
    manifestAtual = M2;
    travar = new Set([`/data/${DSA}.json`]);
    await focar();
    expect(conta(`/data/${DSA}.json`)).toBe(2); // R1 buscou o fato novo
    // …?fato= troca p/ DSB no meio do voo (mount-B, fato DSB também preso)…
    fatoParamAtual = DSB;
    travar = new Set([`/data/${DSB}.json`]);
    await act(async () => {
      root!.render(<PaginaRegiao params={{ ibge: "3550308" }} />);
    });
    await flushRotacao();
    expect(div.querySelector('[role="status"]')).not.toBeNull(); // loader do mount-B
    // …R1 morre stale (sem publish) e o finally dele roda no meio do voo
    // do mount-B (sem token, limpa o flag alheio)…
    pendentes.get(`/data/${DSA}.json`)!();
    await flushRotacao();
    // …nova rotação (M3) + foco: com token, nenhum run dispara — o mount-B
    // segue dono atual (sem token, R2 publica e o mount-B sobrescreve stale).
    manifestAtual = M3;
    travar = new Set();
    await focar();
    expect(div.querySelector('[role="status"]')).not.toBeNull(); // mount-B segue dono
    expect(conta(`/data/${DSB}.json`)).toBe(1); // R2 nem buscou (sem token: 2)
    expect(conta("/data/manifest.json")).toBe(3); // R2 nem releu (sem token: 4)
    // …mount-B assenta por último, sem overwrite stale anterior.
    pendentes.get(`/data/${DSB}.json`)!();
    await flushRotacao();
    expect(div.innerHTML).toContain("Cand C");
  });
});
