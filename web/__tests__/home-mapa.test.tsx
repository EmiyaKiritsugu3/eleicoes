// @vitest-environment jsdom
// EVOLVE-4 Task 3: Home renderiza MapaBrasil clicável quando há malha
// (clique → foco no filtro UF); sem malha, fallback honesto na lista v1
// (tabela de votos por UF) — fail-closed, nunca canvas quebrado.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { HomeContent, ufDeSelecaoMapa } from "../components/HomeContent";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SEM_DADO = "sem dado oficial";

const RESUMO = { total_votos: 3000, total_linhas: 3, anos: [2022], tabelas: [] };
const POR_UF = [
  { ano: 2022, cargo: "presidente", uf: "SP", votos: 2000 },
  { ano: 2022, cargo: "presidente", uf: "RJ", votos: 1000 },
];
const POR_CAND = [{ candidato_id: "a", nome_urna: "Cand A", partido: "PA", votos: 2500 }];
const MANIFEST_OK = {
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
const MANIFEST_INVALIDO = { ingestions: [] };

// Malha fixture mínima: quadrado SP (3550308) + faixa RJ (3304557),
// mesmo padrão de web/__tests__/mapa.test.tsx (deltas + transform).
const FIXTURE_TOPO_2UF = {
  type: "Topology",
  transform: { scale: [1, 1], translate: [0, 0] },
  objects: {
    municipios: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          properties: { ibge7: "3550308", uf: "SP", nome: "São Paulo" },
          arcs: [[0]],
        },
        {
          type: "Polygon",
          properties: { ibge7: "3304557", uf: "RJ", nome: "Rio de Janeiro" },
          arcs: [[1]],
        },
      ],
    },
  },
  arcs: [
    [
      [0, 0],
      [0, 10],
      [10, 0],
      [0, -10],
      [-10, 0],
    ],
    [
      [11, 0],
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ],
  ],
};

// Topologia válida no HTTP mas sem geometrias: loadMalha rejeita
// ("malha vazia ou inválida") — HTTP 200 sozinho não basta.
const FIXTURE_TOPO_VAZIA = {
  type: "Topology",
  objects: { municipios: { type: "GeometryCollection", geometries: [] } },
  arcs: [],
};

type ModoMalha = "ok" | "ausente" | "vazia";

function mockFetchHome(manifest: unknown, malha: ModoMalha) {
  const mock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (String(url).endsWith("/data/por_uf.json")) return { ok: true, json: async () => POR_UF };
    if (String(url).endsWith("/data/por_candidato.json"))
      return { ok: true, json: async () => POR_CAND };
    if (String(url).endsWith("/data/manifest.json")) return { ok: true, json: async () => manifest };
    if (String(url).endsWith("/data/malha_municipios.topojson")) {
      if (malha === "ausente") return { ok: false, status: 404, json: async () => null };
      if (malha === "vazia") return { ok: true, json: async () => FIXTURE_TOPO_VAZIA };
      return { ok: true, json: async () => FIXTURE_TOPO_2UF };
    }
    return { ok: false, json: async () => null };
  });
  (globalThis as Record<string, unknown>).fetch = mock;
  return mock;
}

function chamadasMalha(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter((c) =>
    String(c[0]).endsWith("/data/malha_municipios.topojson"),
  ).length;
}

function mockPath2D() {
  const g = globalThis as Record<string, unknown>;
  const prev = g["Path2D"];
  g["Path2D"] = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  return () => {
    g["Path2D"] = prev;
  };
}

function mockCanvas2d() {
  const fake = {
    clearRect() {},
    fill() {},
    stroke() {},
    fillStyle: "",
    strokeStyle: "",
  };
  const spy = vi
    .spyOn(window.HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(fake as unknown as CanvasRenderingContext2D);
  return () => spy.mockRestore();
}

const fetchOriginal = globalThis.fetch;
let el: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

async function renderHome(): Promise<HTMLDivElement> {
  el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el!);
    root.render(<HomeContent />);
  });
  for (let i = 0; i < 8; i++) {
    await act(async () => {});
  }
  return el!;
}

function secaoMapa(html: string): string {
  const m = html.match(/<section aria-label="Mapa por UF">([\s\S]*?)<\/section>/);
  return m ? m[1] : "";
}

/** Ponto CSS (rect 400x300) p/ um ponto da malha, via transform do canvas. */
function cliqueCssParaMalha(canvas: HTMLCanvasElement, mx: number, my: number) {
  const t = JSON.parse(canvas.dataset.transform as string) as number[];
  const [s, ox, oy] = t;
  return { x: (mx * s + ox) / 2, y: (my * s + oy) / 2 };
}

describe("ufDeSelecaoMapa (clique no mapa → foco UF, fail-closed)", () => {
  it("sigla UF foca direto; IBGE7 resolve pelo prefixo do estado", () => {
    expect(ufDeSelecaoMapa("SP")).toBe("SP");
    expect(ufDeSelecaoMapa("3550308")).toBe("SP");
    expect(ufDeSelecaoMapa("3304557")).toBe("RJ");
  });
  it("EXTERIOR e desconhecidos não focam (null, sem chute)", () => {
    expect(ufDeSelecaoMapa("EXTERIOR")).toBeNull();
    expect(ufDeSelecaoMapa("")).toBeNull();
    expect(ufDeSelecaoMapa("ZZ")).toBeNull();
    expect(ufDeSelecaoMapa("123")).toBeNull();
  });
});

describe("Home com malha: mapa clicável foca o filtro UF", () => {
  it("renderiza <canvas> (mapa) em vez da lista v1", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderHome();
      const mapa = secaoMapa(div.innerHTML);
      expect(mapa).not.toBe("");
      expect(mapa).toContain("<canvas");
      expect(mapa).not.toContain("Votos por UF");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
  it("clique no município foca a UF no filtro (SP e RJ)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderHome();
      const canvas = div.querySelector(
        'section[aria-label="Mapa por UF"] canvas',
      ) as HTMLCanvasElement | null;
      expect(canvas).not.toBeNull();
      canvas!.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
      // Centro de SP na malha (5,-5); centro de RJ (11.5,-0.5).
      const pSP = cliqueCssParaMalha(canvas!, 5, -5);
      await act(async () => {
        canvas!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: pSP.x, clientY: pSP.y }),
        );
      });
      const ufInput = div.querySelector(
        'section[aria-label="Busca"] input[aria-label="uf"]',
      ) as HTMLInputElement | null;
      expect(ufInput).not.toBeNull();
      expect(ufInput!.value).toBe("SP");
      const pRJ = cliqueCssParaMalha(canvas!, 11.5, -0.5);
      await act(async () => {
        canvas!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: pRJ.x, clientY: pRJ.y }),
        );
      });
      expect(ufInput!.value).toBe("RJ");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});

describe("Home com malha: resolução única, sem botão Exterior morto", () => {
  it("busca a malha uma única vez (Home resolve; MapaBrasil não refaz)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    const fetchMock = mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderHome();
      expect(secaoMapa(div.innerHTML)).toContain("<canvas");
      expect(chamadasMalha(fetchMock)).toBe(1);
    } finally {
      restoreCtx();
      restorePath();
    }
  });
  it("sem botão Exterior na Home (filtro é por UF; EXTERIOR não foca)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderHome();
      const mapa = secaoMapa(div.innerHTML);
      expect(mapa).toContain("<canvas");
      expect(mapa).not.toContain("Exterior");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});

describe("Home sem malha: fallback honesto na lista v1", () => {
  it("sem artefato (404) mostra a tabela de votos por UF, sem canvas", async () => {
    mockFetchHome(MANIFEST_OK, "ausente");
    const div = await renderHome();
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).not.toBe("");
    expect(mapa).toContain("Votos por UF");
    expect(mapa).toContain("SP");
    expect(mapa).not.toContain("<canvas");
  });
  it("malha vazia com HTTP 200 também cai na lista v1 (conteúdo, não só status)", async () => {
    mockFetchHome(MANIFEST_OK, "vazia");
    const div = await renderHome();
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).not.toBe("");
    expect(mapa).toContain("Votos por UF");
    expect(mapa).not.toContain("<canvas");
  });
  it("sem prova, a seção suprime mesmo com malha (paridade fail-closed)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_INVALIDO, "ok");
    try {
      const div = await renderHome();
      const mapa = secaoMapa(div.innerHTML);
      expect(mapa).not.toBe("");
      expect(mapa).toContain(SEM_DADO);
      expect(mapa).not.toContain("<canvas");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});
