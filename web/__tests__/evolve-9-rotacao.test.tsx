// @vitest-environment jsdom
// EVOLVE-9 Task 3: (a) PainelRegiao sem self-fetch — a página /regiao detém
// o mapa do Censo (prop `censo` sempre repassada, null inicial); o effect
// interno que buscava CENSO_URL + manifest quando `censo===undefined` era
// morto em prod (VERIFICADO: único call site produtivo sempre passa a prop)
// e fork de fetch cru — removido. Prop omitida → SEM_DADO sem nenhum fetch
// (fail-closed). (b) paridade de rotação: Explorar/Verificar/Analisar re-lêem
// o manifest em focus/visibilitychange (padrão Home/regiao: guard de geração,
// sem-duplicado, cleanup) e só refazem o fetch pesado com selo mudado.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import PainelRegiao from "../components/PainelRegiao";
import ExplorarPage from "../app/explorar/page";
import VerificarPage from "../app/verificar/page";
import AnalisarPage from "../app/analisar/page";
import {
  SEM_DADO,
  RESUMO,
  POR_UF,
  POR_CAND,
  instalarFetchRoteado,
  contaChamadas,
  focarRotacao,
  montarRotacao,
  flushRotacao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
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
const MANIFEST_A = manifestComHash(HASH_A);
const MANIFEST_B = manifestComHash(HASH_B);

function demo() {
  return {
    esc_sup: 12, esc_med: 30, esc_fund: 50, renda_media: 2200,
    pobres_pct: 18, idade_mediana: 34, urbanizacao: 85,
    pop: 12000, eleitores: 10000,
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
const CENSO = { "3550308": 12345 };

const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };

function perfil(html: string): string {
  return html.split("<h2>Perfil do lugar</h2>")[1] ?? "";
}

// Roteadores mutáveis: a rotação troca manifest/dados SEM remontar a página.
let manifestAtual: unknown = MANIFEST_A;
let fatoAtual: unknown = FATO;
let porUfAtual: unknown = POR_UF;
// Blip de rede: com true, o fetch do manifest REJEITA (offline) — a rotação
// deve manter o último selo validado, nunca suprimir dado válido.
let falharManifest = false;
// Buraco 200+null: fetch OK mas corpo JSON null — passa no `status==="ok"`
// e derivava selo vazio (wipe). Também deve manter o último válido.
let manifestNulo = false;
const chamadas: string[] = [];

function instalarRotacao() {
  manifestAtual = MANIFEST_A;
  fatoAtual = FATO;
  porUfAtual = POR_UF;
  falharManifest = false;
  manifestNulo = false;
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) {
      if (falharManifest) throw new TypeError("fetch failed");
      if (manifestNulo) return { ok: true, json: async () => null };
      return { ok: true, json: async () => manifestAtual };
    }
    if (u.endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json")) return { ok: true, json: async () => porUfAtual };
    if (u.endsWith("/data/por_candidato.json")) return { ok: true, json: async () => POR_CAND };
    if (u.includes("/data/fato_")) return { ok: true, json: async () => fatoAtual };
    return { ok: false, json: async () => null };
  });
}

const conta = (sufixo: string): number => contaChamadas(chamadas, sufixo);

// visibilitychange com aba visível (o handler só reage a visible).
async function voltarVisivel(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  try {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushRotacao();
  } finally {
    Object.defineProperty(document, "visibilityState", { value: "prerender", configurable: true });
  }
}

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(nodo: React.ReactElement): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(nodo));
  return el!;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  vi.unstubAllGlobals();
});

describe("PainelRegiao sem self-fetch (EVOLVE-9 Task 3a)", () => {
  it("prop omitida → SEM_DADO sem nenhum fetch (self-fetch morto removido)", async () => {
    instalarRotacao();
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    const linha = (perfil(div.innerHTML).split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    // Zero fetch cru: nem manifest, nem Censo — a página detém o mapa.
    expect(chamadas).toEqual([]);
  });

  it("com prop censo → número sem nenhum fetch (seam determinístico intacto)", async () => {
    instalarRotacao();
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked censo={CENSO} />,
    );
    expect(perfil(div.innerHTML)).toContain("12.345");
    expect(chamadas).toEqual([]);
  });
});

describe("/explorar: rotação de manifest (EVOLVE-9 Task 3b)", () => {
  it("manifest trocado + foco → selo novo (sem stale)", async () => {
    instalarRotacao();
    const div = await montar(<ExplorarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestAtual = MANIFEST_B;
    await focarRotacao();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
    expect(div.innerHTML).not.toContain(`sha256: ${HASH_A}`);
  });

  it("foco sem rotação: só o manifest barato é relido (sem fetch duplicado)", async () => {
    instalarRotacao();
    const div = await montar(<ExplorarPage />);
    void div;
    expect(conta("/data/manifest.json")).toBe(1);
    expect(conta(`/data/${DS}.json`)).toBe(1);
    await focarRotacao();
    expect(conta("/data/manifest.json")).toBe(2);
    expect(conta(`/data/${DS}.json`)).toBe(1);
  });

  it("visibilitychange visível com manifest trocado → selo novo", async () => {
    instalarRotacao();
    const div = await montar(<ExplorarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestAtual = MANIFEST_B;
    await voltarVisivel();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
  });

  it("blip no manifest (fetch rejeita) → dado válido mantido, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<ExplorarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    falharManifest = true;
    await focarRotacao();
    // Stale-while-revalidate: falha ≠ rotação — selo e fato intactos.
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).not.toContain("dado não auditado");
    expect(conta(`/data/${DS}.json`)).toBe(1);
  });

  it("manifest 200 com corpo null → dado válido mantido, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<ExplorarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestNulo = true;
    await focarRotacao();
    // null não é manifest: mantém o último selo validado (sem wipe).
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).not.toContain("dado não auditado");
    expect(conta(`/data/${DS}.json`)).toBe(1);
  });
});

describe("/verificar: rotação de manifest (EVOLVE-9 Task 3b)", () => {
  it("manifest trocado + foco → selo novo (sem stale)", async () => {
    instalarRotacao();
    const div = await montar(<VerificarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestAtual = MANIFEST_B;
    await focarRotacao();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
    expect(div.innerHTML).not.toContain(`sha256: ${HASH_A}`);
  });

  it("foco sem rotação: só o manifest barato é relido", async () => {
    instalarRotacao();
    const div = await montar(<VerificarPage />);
    void div;
    expect(conta("/data/manifest.json")).toBe(1);
    await focarRotacao();
    expect(conta("/data/manifest.json")).toBe(2);
    // Sem fetch pesado nesta rota: tudo o que foi buscado foi manifest.
    expect(chamadas.every((u) => u.endsWith("/data/manifest.json"))).toBe(true);
  });

  it("visibilitychange visível com manifest trocado → selo novo", async () => {
    instalarRotacao();
    const div = await montar(<VerificarPage />);
    manifestAtual = MANIFEST_B;
    await voltarVisivel();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
  });

  it("blip no manifest (fetch rejeita) → selo válido mantido, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<VerificarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    falharManifest = true;
    await focarRotacao();
    // Stale-while-revalidate: falha ≠ rotação — selo intacto.
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).not.toContain("dado não auditado");
  });

  it("manifest 200 com corpo null → selo válido mantido, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<VerificarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestNulo = true;
    await focarRotacao();
    // null não é manifest: mantém o último selo validado (sem wipe).
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).not.toContain("dado não auditado");
  });
});

describe("/analisar: rotação de manifest (EVOLVE-9 Task 3b)", () => {
  it("manifest trocado + foco → selo novo (sem stale)", async () => {
    instalarRotacao();
    const div = await montar(<AnalisarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    manifestAtual = MANIFEST_B;
    await focarRotacao();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
    expect(div.innerHTML).not.toContain(`sha256: ${HASH_A}`);
  });

  it("foco sem rotação: só o manifest barato é relido (sem fetch duplicado)", async () => {
    instalarRotacao();
    const div = await montar(<AnalisarPage />);
    void div;
    expect(conta("/data/manifest.json")).toBe(1);
    expect(conta("/data/resumo.json")).toBe(1);
    await focarRotacao();
    expect(conta("/data/manifest.json")).toBe(2);
    expect(conta("/data/resumo.json")).toBe(1);
    expect(conta("/data/por_uf.json")).toBe(1);
  });

  it("visibilitychange visível com manifest trocado → selo novo", async () => {
    instalarRotacao();
    const div = await montar(<AnalisarPage />);
    manifestAtual = MANIFEST_B;
    await voltarVisivel();
    expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
  });

  it("blip no manifest (fetch rejeita) → números mantidos, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<AnalisarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).toContain("Total de votos no filtro: 3.000");
    falharManifest = true;
    await focarRotacao();
    // Stale-while-revalidate: falha ≠ rotação — selo e números intactos,
    // sem refetch pesado sobre dado válido.
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).toContain("Total de votos no filtro: 3.000");
    expect(div.innerHTML).not.toContain("dado não auditado");
    expect(conta("/data/resumo.json")).toBe(1);
  });

  it("manifest 200 com corpo null → números mantidos, sem supressão", async () => {
    instalarRotacao();
    const div = await montar(<AnalisarPage />);
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).toContain("Total de votos no filtro: 3.000");
    manifestNulo = true;
    await focarRotacao();
    // null não é manifest: mantém selo e números (sem wipe, sem pesado).
    expect(conta("/data/manifest.json")).toBe(2); // foco retentou a leitura
    expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
    expect(div.innerHTML).toContain("Total de votos no filtro: 3.000");
    expect(div.innerHTML).not.toContain("dado não auditado");
    expect(conta("/data/resumo.json")).toBe(1);
  });
});
