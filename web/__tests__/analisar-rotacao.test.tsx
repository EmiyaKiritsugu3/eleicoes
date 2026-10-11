// @vitest-environment jsdom
// EVOLVE-10 Task 6: thread do manifest já lido em `carregarPesados` na
// /analisar — no foco/volta de visibilidade, a rotação-com-mudança refaz o
// fetch pesado (resumo/uf/candidatos) UMA vez reaproveitando o manifest já
// lido (sem fetch duplicado); foco sem-op só relê o manifest barato;
// semântica idêntica (números assentam com o selo).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import Analisar from "../app/analisar/page";
import {
  MANIFEST_OK,
  POR_UF,
  POR_CAND,
  RESUMO,
  teardownJsdom,
  secao,
  instalarFetchRoteado,
  contaChamadas,
  focarRotacao,
  montarRotacao,
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

// Roteador mutável: a rotação troca manifest/dados SEM remontar a página.
// Manifest girado deriva do OK (só o sha muda → selo diferente); por_uf
// girado soma 3000/voto (total 3.000 → 9.000) sem duplicar literais.
let manifestAtual: unknown = MANIFEST_OK;
let porUfAtual: unknown = POR_UF;
const chamadas: string[] = [];

const MANIFEST_GIRADO = {
  ingestions: [{ ...MANIFEST_OK.ingestions[0], sha256: "b".repeat(64), date: "2026-02-02" }],
};
const POR_UF_GIRADO = POR_UF.map((r) => ({ ...r, votos: r.votos + 3000 }));

function instalarFetchMutavel() {
  manifestAtual = MANIFEST_OK;
  porUfAtual = POR_UF;
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json")) return { ok: true, json: async () => porUfAtual };
    if (u.endsWith("/data/por_candidato.json")) return { ok: true, json: async () => POR_CAND };
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    return { ok: false, json: async () => null };
  });
}

const conta = (sufixo: string): number => contaChamadas(chamadas, sufixo);

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<Analisar />));
  return el!;
}

describe("analisar: refetch em rotação de manifest (foco)", () => {
  it("foco sem rotação: só o manifest barato é relido (sem fetch duplicado)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(secao(div.innerHTML, "Resumo filtrado")).toContain("3.000");
    expect(conta("/data/por_uf.json")).toBe(1);
    expect(conta("/data/manifest.json")).toBe(1);
    await focarRotacao();
    expect(conta("/data/manifest.json")).toBe(2);
    expect(conta("/data/por_uf.json")).toBe(1);
    expect(conta("/data/resumo.json")).toBe(1);
  });

  it("rotação com mudança reaproveita o manifest já lido (sem fetch duplicado)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(secao(div.innerHTML, "Resumo filtrado")).toContain("3.000");
    expect(conta("/data/manifest.json")).toBe(1);
    manifestAtual = MANIFEST_GIRADO;
    porUfAtual = POR_UF_GIRADO;
    await focarRotacao();
    const resumo = secao(div.innerHTML, "Resumo filtrado");
    expect(resumo).toContain("9.000");
    expect(resumo).not.toContain("3.000");
    expect(conta("/data/por_uf.json")).toBe(2);
    expect(conta("/data/manifest.json")).toBe(2);
  });
});
