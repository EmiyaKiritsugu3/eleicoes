// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import PaginaRegiao from "../app/regiao/[ibge]/page";

// eslint-disable-next-line prefer-const
let fatoParamAtual = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "fato" ? fatoParamAtual : null) }),
}));

const HASH_A = "aa".repeat(32);
const HASH_B = "bb".repeat(32);

const MANIFEST = {
  ingestions: [
    { tipo: "fato_municipal", dataset: "fato_2022_1_presidente", sha256: HASH_A, source_url: "https://cdn.tse.jus.br/a" },
    { tipo: "fato_municipal", dataset: "fato_2022_2_presidente", sha256: HASH_B, source_url: "https://cdn.tse.jus.br/b" },
  ],
};

function demo() {
  return {
    esc_sup: 12, esc_med: 30, esc_fund: 50, renda_media: 2200, pobres_pct: 18,
    idade_mediana: 34, urbanizacao: 85, pop: 12000, eleitores: 10000,
  };
}

const FATO_A = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    { ibge: "3550300", uf: "SP", nome: "Mun 0", votos: [600, 400], total: 1000, abst: 100, demo: demo() },
  ],
};

const FATO_B = {
  candidatos: [
    { id: "C", nome: "Cand C", partido: "PC" },
    { id: "D", nome: "Cand D", partido: "PD" },
  ],
  municipios: [
    { ibge: "3550300", uf: "SP", nome: "Mun 0", votos: [700, 300], total: 1000, abst: 100, demo: demo() },
  ],
};

const fetchOriginal = globalThis.fetch;

describe("troca de ?fato= nunca exibe dado antigo sob selo novo", () => {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let liberaB = () => {};

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    el?.remove();
    el = null;
    globalThis.fetch = fetchOriginal;
    fatoParamAtual = "";
  });

  it("limpa o fato anterior antes do novo fetch (sem mismatch transitório)", async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => MANIFEST };
      if (url === "/data/fato_2022_2_presidente.json") {
        await new Promise<void>((res) => {
          liberaB = res;
        });
        return { ok: true, json: async () => FATO_B };
      }
      return { ok: true, json: async () => FATO_A };
    });
    el = document.createElement("div");
    document.body.appendChild(el);

    await act(async () => {
      root = createRoot(el!);
      root.render(<PaginaRegiao params={{ ibge: "3550300" }} />);
    });
    await act(async () => {});
    expect(el!.textContent ?? "").toContain("Cand A");

    // Troca para o pleito B, cujo fetch fica pendente.
    fatoParamAtual = "fato_2022_2_presidente";
    await act(async () => {
      root!.render(<PaginaRegiao params={{ ibge: "3550300" }} />);
    });
    await act(async () => {});

    const meio = el!.textContent ?? "";
    // Selo novo já aplicado...
    expect(meio).toContain("b".repeat(8));
    // ...mas números do dataset antigo sumiram (nada de A) e B ainda não chegou.
    expect(meio).not.toContain("Cand A");
    expect(meio).not.toContain("Cand C");

    await act(async () => {
      liberaB();
    });
    await act(async () => {});
    const fim = el!.textContent ?? "";
    expect(fim).toContain("Cand C");
    expect(fim).not.toContain("Cand A");
  });
});
