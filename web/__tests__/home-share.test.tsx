// @vitest-environment jsdom
// EVOLVE-11 Task 3 (Home share parity): a Home não tinha CopyShare
// (Analisar/Explorar têm) — adiciona âncora de proveniência `/?hash=`
// gated em `seal.official`. Sem oficial, sem share (a Home não hidrata
// filtros da query, então link sem hash não reproduziria nada — honesto).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import { HomeContent } from "../components/HomeContent";
import {
  MANIFEST_OK,
  MANIFEST_INVALIDO,
  POR_UF,
  POR_CAND,
  RESUMO,
  teardownJsdom,
  instalarFetchRoteado,
  montarRotacao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLDivElement | null = null;
let root: Root | null = null;
let manifestAtual: unknown = MANIFEST_OK;
const chamadas: string[] = [];

function instalar() {
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json")) return { ok: true, json: async () => POR_UF };
    if (u.endsWith("/data/por_candidato.json")) return { ok: true, json: async () => POR_CAND };
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    if (u.endsWith("/data/malha_municipios.topojson")) {
      return { ok: false, status: 404, json: async () => null };
    }
    return { ok: false, json: async () => null };
  });
}

async function montar(): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<HomeContent />));
  return el!;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  manifestAtual = MANIFEST_OK;
  await teardownJsdom();
});

describe("home: share de proveniência (EVOLVE-11 Task 3)", () => {
  it("com selo oficial: 'Copiar link' com hash do manifest (cubic R3)", async () => {
    manifestAtual = MANIFEST_OK;
    instalar();
    const div = await montar();
    expect(div.innerHTML).toContain("Copiar link");
    // Proveniência real: o hash da ingestão oficial, não só `hash=` vazio.
    expect(div.innerHTML).toContain(`hash=${"a".repeat(64)}`);
  });

  it("sem selo oficial: sem share (link sem hash não reproduziria nada)", async () => {
    manifestAtual = MANIFEST_INVALIDO;
    instalar();
    const div = await montar();
    expect(div.innerHTML).not.toContain("Copiar link");
  });

  it("?hash= divergente do manifest: alerta (cubic R3)", async () => {
    window.history.replaceState(null, "", "/?hash=" + "0".repeat(64));
    try {
      manifestAtual = MANIFEST_OK;
      instalar();
      const div = await montar();
      expect(div.innerHTML).toContain("diverge do manifest atual");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("?hash= igual ao manifest: sem alerta", async () => {
    window.history.replaceState(null, "", "/?hash=" + "a".repeat(64));
    try {
      manifestAtual = MANIFEST_OK;
      instalar();
      const div = await montar();
      expect(div.innerHTML).not.toContain("diverge do manifest atual");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
