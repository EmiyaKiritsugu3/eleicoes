// @vitest-environment jsdom
// EVOLVE-9 Task 4 (RED): (a) erro de download do manifest vira mensagem
// visível `role=status` (nada de .catch silencioso); (b) pivô por partido
// usa chave interna estável p/ sem-partido — rótulo SEM_DADO é só display
// e nunca colide com categoria real (nem se um partido se chamar
// literalmente "sem dado oficial").
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import Auditoria from "../app/auditoria/page";
import Analisar from "../app/analisar/page";
import {
  SEM_DADO,
  RESUMO,
  POR_UF,
  MANIFEST_OK,
  instalarFetchRoteado,
  montarRotacao,
  flushRotacao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let chamadas: string[] = [];
let el: HTMLDivElement | null = null;
let root: { unmount: () => void } | null = null;

function instalarManifestOk() {
  chamadas = [];
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json"))
      return { ok: true, json: async () => MANIFEST_OK };
    if (u.endsWith("/data/resumo.json"))
      return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json"))
      return { ok: true, json: async () => POR_UF };
    if (u.endsWith("/data/por_candidato.json"))
      return { ok: true, json: async () => [] };
    return { ok: false, json: async () => null };
  });
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

describe("EVOLVE-9 Task 4a: erro de download vira role=status visível", () => {
  it("fetch reject no download → mensagem visível (fail-closed + feedback)", async () => {
    instalarManifestOk();
    ({ el, root } = await montarRotacao(<Auditoria />));
    const btn = el!.querySelector(
      'section[aria-label="Baixar manifest"] button',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBe(null);
    expect(btn!.disabled).toBe(false);
    // Download falha (rede) depois do load inicial ok.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await act(async () => {
      btn!.click();
    });
    await flushRotacao();
    const status = el!.querySelector(
      'section[aria-label="Baixar manifest"] p[role="status"]',
    );
    expect(status).not.toBe(null);
    expect(status!.textContent ?? "").toMatch(/falha.*download/i);
  });
});

describe("EVOLVE-9 Task 4b: pivô sem-partido com chave estável", () => {
  it("sem-partido renderiza SEM_DADO sem fundir com categoria real homônima", async () => {
    chamadas = [];
    const POR_CAND_COLISAO = [
      { candidato_id: "s1", nome_urna: "Sem Partido", partido: "", votos: 100 },
      {
        candidato_id: "s2",
        nome_urna: "Partido Homônimo",
        partido: SEM_DADO,
        votos: 200,
      },
    ];
    instalarFetchRoteado(chamadas, (u) => {
      if (u.endsWith("/data/manifest.json"))
        return { ok: true, json: async () => MANIFEST_OK };
      if (u.endsWith("/data/resumo.json"))
        return { ok: true, json: async () => RESUMO };
      if (u.endsWith("/data/por_uf.json"))
        return { ok: true, json: async () => POR_UF };
      if (u.endsWith("/data/por_candidato.json"))
        return { ok: true, json: async () => POR_CAND_COLISAO };
      return { ok: false, json: async () => null };
    });
    ({ el, root } = await montarRotacao(<Analisar />));
    // Troca o pivô para partido (radios na ordem uf/partido/ano).
    const radios = el!.querySelectorAll('section[aria-label="Pivô"] input[name="pivo"]');
    expect(radios.length).toBe(3);
    await act(async () => {
      (radios[1] as HTMLInputElement).click();
    });
    await flushRotacao();
    const linhas = el!.querySelectorAll('section[aria-label="Pivô"] tbody tr');
    // Duas categorias distintas — sem fusão (100 e 200 separados, nunca 300).
    expect(linhas.length).toBe(2);
    const cels = [...linhas].map((tr) => tr.querySelectorAll("td")[0]?.textContent ?? "");
    expect(cels.every((c) => c === SEM_DADO)).toBe(true);
    const votos = [...linhas].map((tr) => tr.querySelectorAll("td")[1]?.textContent ?? "");
    expect(votos).toContain("100");
    expect(votos).toContain("200");
    expect(votos).not.toContain("300");
  });
});
