// @vitest-environment jsdom
// EVOLVE-10 Task 5: trigger vivo de rotação de manifest na /auditoria —
// no foco/volta de visibilidade, re-lê o manifest (barato) e atualiza o
// display (hashes/contagens) quando mudou; display-only, sem mudança de
// semântica de supressão; falha mantém o último display validado
// (stale-while-revalidate).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import Auditoria from "../app/auditoria/page";
import {
  instalarFetchRoteado,
  contaChamadas,
  focarRotacao,
  voltarVisivelRotacao,
  montarRotacao,
  teardownJsdom,
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

let manifestAtual: unknown = null;
const chamadas: string[] = [];

const MANIFEST_A = {
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

const MANIFEST_B = {
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

function instalarFetchMutavel() {
  manifestAtual = MANIFEST_A;
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) return { ok: true, json: async () => manifestAtual };
    return { ok: false, json: async () => null };
  });
}

const contaManifest = (): number => contaChamadas(chamadas, "/data/manifest.json");

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(<Auditoria />));
  return el!;
}

describe("auditoria: refetch em rotação de manifest (foco)", () => {
  it("manifest trocado + foco → hash novo na tabela (sem stale)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("a".repeat(64));
    manifestAtual = MANIFEST_B;
    await focarRotacao();
    expect(div.innerHTML).toContain("b".repeat(64));
    expect(div.innerHTML).not.toContain("a".repeat(64));
  });

  it("foco sem rotação não republica (só o manifest barato)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    void div;
    expect(contaManifest()).toBe(1);
    await focarRotacao();
    expect(contaManifest()).toBe(2);
  });

  it("visibilidade de volta com manifest trocado → hash novo", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("a".repeat(64));
    manifestAtual = MANIFEST_B;
    await voltarVisivelRotacao();
    expect(div.innerHTML).toContain("b".repeat(64));
  });

  it("falha no refetch mantém o último display validado (stale-while-revalidate)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("a".repeat(64));
    manifestAtual = null;
    await focarRotacao();
    expect(div.innerHTML).toContain("a".repeat(64));
  });

  // rotfix3 Finding 1: `{ingestions:[null]}` passa no guard de array mas
  // quebra o render (`e.sha256` em null) — o helper partilhado deve
  // rejeitar entries não-dict (paridade ETL `verify_manifest`, que reprova
  // malformada) e a rotação mantém o último display validado, sem crash.
  it("{ingestions:[null]} mantém o último display validado (sem crash)", async () => {
    instalarFetchMutavel();
    const div = await montar();
    expect(div.innerHTML).toContain("a".repeat(64));
    manifestAtual = { ingestions: [null] };
    await focarRotacao();
    expect(div.innerHTML).toContain("a".repeat(64));
    // Sem wipe e sem banner fail-closed: o display validado segue intacto.
    expect(div.querySelector('[role="alert"]')).toBeNull();
  });
});
