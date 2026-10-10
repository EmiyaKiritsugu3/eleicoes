// @vitest-environment jsdom
// EVOLVE-7 Task 6: trigger vivo de rotação de manifest na Home — no foco /
// volta de visibilidade, a Home re-lê o manifest e só refaz o fetch pesado
// (resumo/uf/candidatos) quando o selo mudou: sem números stale após rotação,
// sem fetch duplicado quando inalterado, fallback intacto.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { HomeContent } from "../components/HomeContent";
import {
  SEM_DADO,
  MANIFEST_OK,
  MANIFEST_INVALIDO,
  POR_UF,
  POR_CAND,
  RESUMO,
  teardownJsdom,
  secao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  await teardownJsdom();
});

// Roteador mutável: a rotação troca manifest/dados SEM remontar o componente.
let manifestAtual: unknown = MANIFEST_OK;
let porUfAtual: unknown = POR_UF;
let chamadas: string[] = [];

function instalarFetchMutavel() {
  manifestAtual = MANIFEST_OK;
  porUfAtual = POR_UF;
  chamadas = [];
  const mock = vi.fn(async (url: string) => {
    chamadas.push(String(url));
    const u = String(url);
    if (u.endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json")) return { ok: true, json: async () => porUfAtual };
    if (u.endsWith("/data/por_candidato.json")) return { ok: true, json: async () => POR_CAND };
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    if (u.endsWith("/data/malha_municipios.topojson")) {
      return { ok: false, status: 404, json: async () => null };
    }
    return { ok: false, json: async () => null };
  });
  (globalThis as Record<string, unknown>).fetch = mock;
}

function conta(sufixo: string): number {
  return chamadas.filter((c) => c.endsWith(sufixo)).length;
}

async function flush(n = 10) {
  for (let i = 0; i < n; i++) {
    await act(async () => {});
  }
}

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(): Promise<HTMLDivElement> {
  el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el!);
    root.render(<HomeContent />);
  });
  await flush();
  return el!;
}

async function focar() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await flush();
}

const MANIFEST_GIRADO = {
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: "fato_2022_1_presidente",
      sha256: "b".repeat(64),
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-02-02",
    },
  ],
};

const POR_UF_GIRADO = [
  { ano: 2022, cargo: "presidente", uf: "SP", votos: 5000 },
  { ano: 2022, cargo: "presidente", uf: "RJ", votos: 1000 },
];

describe("Home: refetch em rotação de manifest (foco)", () => {
  it("rotação do manifest refaz o fetch e troca os números (sem stale)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(secao(div.innerHTML, "Resumo")).toContain("3.000");
    manifestAtual = MANIFEST_GIRADO;
    porUfAtual = POR_UF_GIRADO;
    await focar();
    const resumo = secao(div.innerHTML, "Resumo");
    expect(resumo).toContain("6.000");
    expect(resumo).not.toContain("3.000");
  });

  it("foco sem rotação não refaz o fetch pesado (só o manifest barato)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    void div;
    expect(conta("/data/por_uf.json")).toBe(1);
    expect(conta("/data/manifest.json")).toBe(1);
    await focar();
    expect(conta("/data/manifest.json")).toBe(2);
    expect(conta("/data/por_uf.json")).toBe(1);
    expect(conta("/data/resumo.json")).toBe(1);
  });

  it("fallback intacto: rotação p/ manifest inválido suprime os números", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(secao(div.innerHTML, "Resumo")).toContain("3.000");
    manifestAtual = MANIFEST_INVALIDO;
    await focar();
    expect(secao(div.innerHTML, "Resumo")).toContain(SEM_DADO);
  });
});
