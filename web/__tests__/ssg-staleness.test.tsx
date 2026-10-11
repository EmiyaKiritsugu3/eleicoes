// @vitest-environment jsdom
// EVOLVE-11 Task 6 (SSG slugs congelam pleito + sem rotação): as páginas
// curadas são estáticas (fato do build) — sem refetch de números. Fecha a
// staleness com disclosure display-only: nota "pleito default do build" +
// alerta quando o manifest servido diverge do hash do build (mount +
// focus/visibility). Nunca toca em números/selo/fato (sem mixing).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import SeloStaleness, { NOTA_PLEITO_CONGELADO } from "../components/SeloStaleness";
import {
  instalarFetchRoteado,
  montarRotacao,
  focarRotacao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const HASH_BUILD = "a".repeat(64);
const HASH_NOVO = "b".repeat(64);

function manifestCom(hash: string | null) {
  return {
    ingestions: hash
      ? [{ tipo: "fato_municipal", dataset: DS, sha256: hash, source_url: "https://cdn.tse.jus.br/x.zip", date: "2026-01-01" }]
      : [],
  };
}

function manifestFixture(hash: string) {
  return {
    ingestions: [
      { tipo: "fato_municipal", dataset: DS, sha256: hash, source_url: "https://cdn.tse.jus.br/x.zip", fixture: true },
    ],
  };
}

let el: HTMLDivElement | null = null;
let root: Root | null = null;
let manifestAtual: unknown = manifestCom(HASH_BUILD);
let fetchOk = true;
const chamadas: string[] = [];

function instalar() {
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) {
      return fetchOk
        ? { ok: true, json: async () => manifestAtual }
        : { ok: false, json: async () => null };
    }
    return { ok: false, json: async () => null };
  });
}

async function montar(hashBuild: string = HASH_BUILD): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<SeloStaleness dataset={DS} hashBuild={hashBuild} />));
  return el!;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  manifestAtual = manifestCom(HASH_BUILD);
  fetchOk = true;
});

describe("SSG staleness display-only (EVOLVE-11 Task 6)", () => {
  it("nota de pleito congelado sempre visível", async () => {
    instalar();
    const div = await montar();
    expect(div.innerHTML).toContain(NOTA_PLEITO_CONGELADO);
    expect(NOTA_PLEITO_CONGELADO).toContain("pleito default do build");
  });

  it("manifest igual ao build: sem alerta (mount + foco)", async () => {
    manifestAtual = manifestCom(HASH_BUILD);
    instalar();
    const div = await montar();
    await focarRotacao();
    expect(div.innerHTML).not.toContain("diverge do build");
    // Invariante sem-refetch (cubic R3): mount + foco emitem exatamente 2
    // requests, ambos ao manifest — nenhum fato/número é buscado.
    expect(chamadas.length).toBe(2);
    expect(chamadas.every((c) => c.endsWith("/data/manifest.json"))).toBe(true);
  });

  it("manifest com hash novo: alerta após foco (display-only)", async () => {
    manifestAtual = manifestCom(HASH_BUILD);
    instalar();
    const div = await montar();
    expect(div.innerHTML).not.toContain("diverge do build");
    manifestAtual = manifestCom(HASH_NOVO);
    await focarRotacao();
    expect(div.innerHTML).toContain("diverge do build");
  });

  it("manifest ilegível (blip): sem alerta falso", async () => {
    manifestAtual = manifestCom(HASH_BUILD);
    instalar();
    const div = await montar();
    fetchOk = false;
    await focarRotacao();
    expect(div.innerHTML).not.toContain("diverge do build");
  });

  it("build sem oficial + manifest agora oficial: alerta (revalide a fonte)", async () => {
    manifestAtual = manifestCom(HASH_NOVO);
    instalar();
    const div = await montar("");
    expect(div.innerHTML).toContain("diverge do build");
  });

  it("rotação só-fixture: alerta quando o hash de amostra muda (cubic R3)", async () => {
    manifestAtual = manifestFixture("f".repeat(64));
    instalar();
    const div = await montar("f".repeat(64));
    expect(div.innerHTML).not.toContain("diverge do build");
    manifestAtual = manifestFixture("e".repeat(64));
    await focarRotacao();
    expect(div.innerHTML).toContain("diverge do build");
  });
});
