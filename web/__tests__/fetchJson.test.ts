// @vitest-environment jsdom
// EVOLVE-8 Task 2 — fetchJson compartilhado com contrato de status: UMA
// definição em `lib/fetchJson` (zero fork nos 6 call sites). Distingue
// 404/500/offline/JSON-inválido vs ok (blip vs rotação real); `.data`
// preserva a semântica legada (T no ok, null em todo erro — fail-closed
// idêntico nos chamadores, sem mudança de política de supressão).
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson } from "../lib/fetchJson";

afterEach(() => {
  vi.unstubAllGlobals();
});

function instalar(resposta: unknown) {
  const mock = vi.fn(async () => resposta);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("fetchJson — contrato de status (EVOLVE-8 Task 2)", () => {
  it("caminho feliz: 200 + JSON válido → ok com o dado", async () => {
    instalar({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    const r = await fetchJson<{ a: number }>("/data/x.json");
    expect(r).toEqual({ status: "ok", data: { a: 1 } });
  });

  it("404 → nao-encontrado com data null", async () => {
    instalar({ ok: false, status: 404, json: async () => null });
    const r = await fetchJson("/data/ausente.json");
    expect(r).toEqual({ status: "nao-encontrado", data: null });
  });

  it("500 → erro-servidor com data null", async () => {
    instalar({ ok: false, status: 500, json: async () => null });
    const r = await fetchJson("/data/x.json");
    expect(r).toEqual({ status: "erro-servidor", data: null });
  });

  it("fetch rejeita (offline) → offline com data null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const r = await fetchJson("/data/x.json");
    expect(r).toEqual({ status: "offline", data: null });
  });

  it("200 + corpo JSON-inválido → resposta-invalida com data null", async () => {
    instalar({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    const r = await fetchJson("/data/x.json");
    expect(r).toEqual({ status: "resposta-invalida", data: null });
  });

  it("preserva cache no-store (união dos 6 forks)", async () => {
    const mock = instalar({ ok: true, status: 200, json: async () => ({}) });
    await fetchJson("/data/x.json");
    expect(mock).toHaveBeenCalledWith("/data/x.json", { cache: "no-store" });
  });

  it("paridade legada: .data é T no ok e null nos 4 erros", async () => {
    const casos: Array<{ resposta: unknown; data: unknown }> = [
      { resposta: { ok: true, status: 200, json: async () => [1] }, data: [1] },
      { resposta: { ok: false, status: 404, json: async () => null }, data: null },
      { resposta: { ok: false, status: 500, json: async () => null }, data: null },
      {
        resposta: {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("bad");
          },
        },
        data: null,
      },
    ];
    for (const c of casos) {
      instalar(c.resposta);
      expect((await fetchJson("/data/x.json")).data).toEqual(c.data);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect((await fetchJson("/data/x.json")).data).toBeNull();
  });
});
