// @vitest-environment jsdom
// EVOLVE-8 Task 1 (selo runtime do Censo): a pop só renderiza com entry
// `artifacts` do Censo no manifest (64-hex, paridade com o gate do fato).
// JSON forjado no path servido + manifest sem entry → SEM_DADO; com entry
// → número. Produtor runtime único: a página (prop `censo` — o self-fetch
// do PainelRegiao foi removido na EVOLVE-9 Task 3; prop omitida → SEM_DADO
// sem fetch, pinado nos dois últimos testes).
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import PaginaRegiao from "../app/regiao/[ibge]/page";
import PainelRegiao from "../components/PainelRegiao";
import {
  SEM_DADO,
  instalarFetchRoteado,
  montarRotacao,
} from "./helpers";
import type { Root } from "react-dom/client";

// eslint-disable-next-line prefer-const
let fatoParamAtual = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "fato" ? fatoParamAtual : null) }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const FATO = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    {
      ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [600, 400],
      total: 1000, abst: 100,
      demo: {
        esc_sup: 12, esc_med: 30, esc_fund: 50, renda_media: 2200,
        pobres_pct: 18, idade_mediana: 34, urbanizacao: 85,
        pop: 12000, eleitores: 10000,
      },
    },
  ],
};
// JSON forjado no path servido: pop absurda que nunca pode renderizar sem selo.
const CENSO_FORJADO = { "3550308": 987654321 };

// Manifest com fato auditado mas SEM entry do Censo (o buraco: qualquer
// JSON neste path renderizava como fato).
const MANIFEST_SEM_CENSO = {
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

const comEntryCenso = (manifest: typeof MANIFEST_SEM_CENSO, sha256: string) => ({
  ...manifest,
  artifacts: [
    {
      arquivo: "censo_municipios.json",
      sha256,
      source_url: "https://cdn.ibge.gov.br/censo.zip",
    },
  ],
});

const chamadas: string[] = [];
function instalar(manifest: unknown, censo: unknown) {
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifest };
    if (u.endsWith("/data/censo_municipios.json")) return { ok: true, json: async () => censo };
    if (u.includes("/data/fato_")) return { ok: true, json: async () => FATO };
    return { ok: false, json: async () => null };
  });
}

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(nodo: React.ReactElement): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(nodo));
  return el!;
}

function perfil(html: string): string {
  return html.split("<h2>Perfil do lugar</h2>")[1] ?? "";
}

const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };

afterEach(async () => {
  const { act } = await import("react-dom/test-utils");
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  fatoParamAtual = "";
});

describe("/regiao: selo runtime do Censo (EVOLVE-8 Task 1)", () => {
  it("forjado + manifest sem entry → pop em SEM_DADO (fato intacto)", async () => {
    instalar(MANIFEST_SEM_CENSO, CENSO_FORJADO);
    const div = await montar(<PaginaRegiao params={{ ibge: "3550308" }} />);
    expect(div.innerHTML).toContain("Cand A"); // gate só suprime a pop
    const p = perfil(div.innerHTML);
    expect(p).toContain("População (Censo 2022)");
    const linha = (p.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    expect(div.innerHTML).not.toContain("987.654.321"); // forjado nunca renderiza
  });

  it("forjado + manifest com entry 64-hex → número (sem falso-negativo)", async () => {
    instalar(comEntryCenso(MANIFEST_SEM_CENSO, "c".repeat(64)), CENSO_FORJADO);
    const div = await montar(<PaginaRegiao params={{ ibge: "3550308" }} />);
    expect(perfil(div.innerHTML)).toContain("987.654.321");
  });

  it("entry com hash fora do formato → SEM_DADO (mesma strictness do fato)", async () => {
    instalar(comEntryCenso(MANIFEST_SEM_CENSO, "abc"), CENSO_FORJADO);
    const div = await montar(<PaginaRegiao params={{ ibge: "3550308" }} />);
    const p = perfil(div.innerHTML);
    const linha = (p.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    expect(div.innerHTML).not.toContain("987.654.321");
  });

  // EVOLVE-9 Task 3: self-fetch do PainelRegiao REMOVIDO (morto em prod —
  // o único call site produtivo, /regiao/[ibge], sempre passa a prop, então
  // `censo===undefined` nunca ocorria fora de testes). Prop omitida →
  // SEM_DADO sem nenhum fetch (fail-closed); a página detém o mapa.
  it("PainelRegiao sem prop censo: SEM_DADO sem nenhum fetch (sem self-fetch)", async () => {
    instalar(MANIFEST_SEM_CENSO, CENSO_FORJADO);
    chamadas.length = 0;
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    const p = perfil(div.innerHTML);
    const linha = (p.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    expect(div.innerHTML).not.toContain("987.654.321");
    expect(chamadas).toEqual([]);
  });

  it("PainelRegiao sem prop censo: SEM_DADO mesmo com entry válida (página detém o mapa)", async () => {
    instalar(comEntryCenso(MANIFEST_SEM_CENSO, "c".repeat(64)), CENSO_FORJADO);
    chamadas.length = 0;
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    const p = perfil(div.innerHTML);
    const linha = (p.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    expect(chamadas).toEqual([]);
  });
});
