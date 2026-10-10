// Fixtures + render helpers compartilhados — FONTE ÚNICA dos blocos antes
// duplicados entre web/__tests__/* (gate Sonar duplication ≤3%).
// Genuine dedupe: cada bloco existe aqui UMA vez; os testes importam
// (com alias quando o nome local é referenciado nos call sites).
// Sem import de código de produção além de tipos.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import type { MunRow } from "../lib/motor";

export const SEM_DADO = "sem dado oficial";

// ---------- fixtures de fetch (/data/*.json + manifest) ----------

export const RESUMO = { total_votos: 3000, total_linhas: 3, anos: [2022], tabelas: [] };
export const POR_UF = [
  { ano: 2022, cargo: "presidente", uf: "SP", votos: 2000 },
  { ano: 2022, cargo: "presidente", uf: "RJ", votos: 1000 },
];
export const POR_CAND = [
  { candidato_id: "a", nome_urna: "Cand A", partido: "PA", votos: 2500, financiamento: 5000 },
];
export const MANIFEST_OK = {
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: "fato_2022_1_presidente",
      sha256: "a".repeat(64),
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    },
  ],
};
export const MANIFEST_INVALIDO = { ingestions: [] };

export const MANIFEST_SOMENTE_FIXTURE = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "f".repeat(64), fixture: true },
  ],
};

// Corpo único do caso "manifest só-fixture": selo oficial nulo, fixture
// sinalizada (usado como `it("...", afirmarSeloSomenteFixture)`).
export async function afirmarSeloSomenteFixture(): Promise<void> {
  const { getSealState } = await import("../lib/data");
  const seal = getSealState(MANIFEST_SOMENTE_FIXTURE);
  expect(seal.official).toBe(null);
  expect(seal.hasFixture).toBe(true);
  expect(seal.fixtureHash).toBe("f".repeat(64));
}

// ---------- malha (topojson mínimo: deltas + transform) ----------

// Malha fixture mínima: quadrado SP (3550308) + faixa RJ (3304557).
export const FIXTURE_TOPO_2UF = {
  type: "Topology",
  transform: { scale: [1, 1], translate: [0, 0] },
  objects: {
    municipios: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          properties: { ibge7: "3550308", uf: "SP", nome: "São Paulo" },
          arcs: [[0]],
        },
        {
          type: "Polygon",
          properties: { ibge7: "3304557", uf: "RJ", nome: "Rio de Janeiro" },
          arcs: [[1]],
        },
      ],
    },
  },
  arcs: [
    [
      [0, 0],
      [0, 10],
      [10, 0],
      [0, -10],
      [-10, 0],
    ],
    [
      [11, 0],
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ],
  ],
};

// Topologia válida no HTTP mas sem geometrias: loadMalha rejeita
// ("malha vazia ou inválida") — HTTP 200 sozinho não basta.
export const FIXTURE_TOPO_VAZIA = {
  type: "Topology",
  objects: { municipios: { type: "GeometryCollection", geometries: [] } },
  arcs: [],
};

// Quadrado único (0,0)-(10,10) rotulado 3550308-SP, nome parametrizado: a
// mesma geometria renomeada testa a rotação de manifest sem duplicar o
// literal (gate Sonar duplication ≤3%). Coords de TELA (pós-flip Y):
// o quadrado geo (0,0)-(10,10) decodifica p/ y -10..0.
export function topoQuadradoUnico(nome: string) {
  return {
    type: "Topology",
    transform: { scale: [1, 1], translate: [0, 0] },
    objects: {
      municipios: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            properties: { ibge7: "3550308", uf: "SP", nome },
            arcs: [[0]],
          },
        ],
      },
    },
    arcs: [
      [
        [0, 0],
        [0, 10],
        [10, 0],
        [0, -10],
        [-10, 0],
      ],
    ],
  };
}

export type ModoMalha = "ok" | "ausente" | "vazia";

// ---------- canvas (jsdom não tem Path2D/getContext real) ----------

export function mockPath2D() {
  const g = globalThis as Record<string, unknown>;
  const prev = g["Path2D"];
  g["Path2D"] = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  return () => {
    g["Path2D"] = prev;
  };
}

export function mockCanvas2d() {
  const fake = {
    clearRect() {},
    fill() {},
    stroke() {},
    fillStyle: "",
    strokeStyle: "",
  };
  const spy = vi
    .spyOn(window.HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(fake as unknown as CanvasRenderingContext2D);
  return () => spy.mockRestore();
}

// ---------- fetch: roteador único p/ resumo/uf/cand/manifest/malha/fato ----------

function okJson(data: unknown) {
  return { ok: true, json: async () => data };
}

function errJson() {
  return { ok: false, json: async () => null };
}

export function responderBasico(
  url: string,
  manifest: unknown,
  malha: ModoMalha | null,
  fato: unknown,
) {
  if (url.endsWith("/data/resumo.json")) return okJson(RESUMO);
  if (url.endsWith("/data/por_uf.json")) return okJson(POR_UF);
  if (url.endsWith("/data/por_candidato.json")) return okJson(POR_CAND);
  if (url.endsWith("/data/manifest.json")) return okJson(manifest);
  if (url.endsWith("/data/malha_municipios.topojson")) {
    if (malha === "vazia") return okJson(FIXTURE_TOPO_VAZIA);
    if (malha === "ok") return okJson(FIXTURE_TOPO_2UF);
    if (malha === "ausente") return { ok: false, status: 404, json: async () => null };
    return errJson();
  }
  if (fato !== null && url.includes("/data/fato_")) return okJson(fato);
  return errJson();
}

// Malha ausente (HTTP 404): o mapa cai no fallback honesto em lista
// (fail-closed) — um stub por estado, sem repetir o literal do fetch.
export function mockFetchMalhaAusente() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
}

// Mock da Home (resumo/uf/cand/manifest + malha tri-estado); devolve o mock
// p/ contagem de chamadas (chamadasMalha).
export function mockFetchHome(manifest: unknown, malha: ModoMalha) {
  const mock = vi.fn(async (url: string) => responderBasico(String(url), manifest, malha, null));
  (globalThis as Record<string, unknown>).fetch = mock;
  return mock;
}

export function chamadasMalha(mock: { mock: { calls: unknown[][] } }): number {
  return mock.mock.calls.filter((c) =>
    String(c[0]).endsWith("/data/malha_municipios.topojson"),
  ).length;
}

// ---------- host jsdom (render + teardown únicos) ----------

const fetchOriginal = globalThis.fetch;
let el: HTMLDivElement | null = null;
let root: Root | null = null;

export async function renderJsdom(node: React.ReactElement): Promise<HTMLDivElement> {
  el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el!);
    root.render(node);
  });
  // Drena a cadeia de fetches sequenciais dos effects (resumo → por_uf →
  // por_candidato → manifest → malha): cada await exige um ciclo de flush.
  for (let i = 0; i < 8; i++) {
    await act(async () => {});
  }
  return el!;
}

export async function rerenderJsdom(node: React.ReactElement): Promise<HTMLDivElement> {
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {});
  return el!;
}

export async function teardownJsdom(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  vi.unstubAllGlobals();
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
}

export function secao(html: string, label: string): string {
  const m = html.match(new RegExp(`<section aria-label="${label}">([\\s\\S]*?)</section>`));
  return m ? m[1] : "";
}

// ---------- fato sintético (40 municípios) ----------

export const CANDIDATOS_LULA = [
  { id: "lula", nome: "Lula", partido: "PT" },
  { id: "bol", nome: "Bolsonaro", partido: "PL" },
];

export const CANDIDATOS_EXEMPLO = [
  { id: "cand-a", nome: "Candidata Exemplo A", partido: "PA" },
  { id: "cand-b", nome: "Candidato Exemplo B", partido: "PB" },
];

export type FatoSintetico = {
  candidatos: typeof CANDIDATOS_EXEMPLO;
  municipios: MunRow[];
} | null;

// Núcleo demo da família lula/vencedor (esc_sup + renda parametrizados;
// demais campos fixos). Cada teste define o wrapper fino de 1 linha.
export function demoBase(escSup: number, rendaMedia: number) {
  return {
    esc_sup: escSup,
    esc_med: 30,
    esc_fund: 50,
    renda_media: rendaMedia,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 1000,
  };
}

// Demo flexível da família cand-a (base + overrides por linha).
export function demoCurada(over: Partial<Record<string, number>> = {}) {
  return {
    esc_sup: 10,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2000,
    pobres_pct: 20,
    idade_mediana: 35,
    urbanizacao: 80,
    pop: 10000,
    eleitores: 1000,
    ...over,
  };
}

// Laço único dos 40 municípios lineares (a = 500+i*10); nome/abst/demo
// variam por família via parâmetros — valores idênticos aos anteriores.
export function municipios40Linear(op: {
  nome: (i: number) => string;
  abst: number | null;
  demo: (i: number) => Record<string, number | null>;
}): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const a = 500 + i * 10;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: op.nome(i),
      votos: [a, 1000 - a],
      total: 1000,
      abst: op.abst,
      demo: op.demo(i),
    });
  }
  return rows;
}

// 40 municípios da família cand-a (abst 50 + demo plena variável).
export function linhas40Municipio(): MunRow[] {
  return municipios40Linear({
    nome: (i) => `Município ${i}`,
    abst: 50,
    demo: (i) =>
      demoCurada({
        esc_sup: 5 + i * 0.5,
        renda_media: 1500 + i * 50,
        pobres_pct: 30 - i * 0.4,
        idade_mediana: 30 + i * 0.2,
        urbanizacao: 60 + i * 0.8,
      }),
  });
}
