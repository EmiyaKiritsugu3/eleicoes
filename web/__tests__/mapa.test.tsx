// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import MapaBrasil, { MapaFallback, precisaFallback } from "../components/MapaBrasil";
import {
  EXTERIOR,
  MALHA_MUNICIPIOS_URL,
  decodeTopojson,
  hitTest,
  loadMalha,
  resolverCliqueMapa,
  UFS,
} from "../lib/malha";

// Malha fixture mínima: um quadrado rotulado 3550308 (São Paulo-SP).
const FIXTURE_TOPO = {
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
  ],
};

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

function mockFetchTopo() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => FIXTURE_TOPO })),
  );
}

describe("mapa fallback sem canvas", () => {
  it("no_canvas_fallback_list: sem Path2D -> lista + link TSE, sem <canvas>", () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g["Path2D"];
    g["Path2D"] = undefined;
    try {
      // Força o guard do componente (typeof Path2D !== "function").
      expect(typeof (g["Path2D"] as unknown)).not.toBe("function");
      const html = renderToStaticMarkup(
        <MapaBrasil malhaUrl="/data/malha_municipios.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      expect(html).not.toContain("<canvas");
      expect(html).toContain("resultados.tse.jus.br");
      for (const uf of UFS.slice(0, 5)) {
        expect(html).toContain(uf);
      }
    } finally {
      g["Path2D"] = prev;
    }
  });
});

describe("mapa hit-test", () => {
  it('onSelectIbge retorna "3550308" ao clicar (mock de hit-test)', () => {
    const feats = decodeTopojson(FIXTURE_TOPO as never);
    expect(feats).toHaveLength(1);
    // Ponto dentro do quadrado (0,0)-(10,10).
    expect(hitTest(feats, 5, 5)).toBe("3550308");
    // Ponto fora retorna null.
    expect(hitTest(feats, 50, 50)).toBeNull();
  });

  it("com Path2D: renderiza <canvas> + botão Exterior separado", () => {
    const restore = mockPath2D();
    try {
      const onSelectIbge = vi.fn();
      const html = renderToStaticMarkup(
        <MapaBrasil
          malhaUrl="/data/malha_municipios.topojson"
          nivel="uf"
          onSelectIbge={onSelectIbge}
        />,
      );
      expect(html).toContain("<canvas");
      expect(html).toContain("Exterior");
    } finally {
      restore();
    }
  });
});

describe("resolverCliqueMapa (escala CSS → backing store)", () => {
  const feats = decodeTopojson(FIXTURE_TOPO as never);
  // Projeção do desenho: s=60, ox=100, oy=0 sobre backing 800x600;
  // ret CSS 400x300 (fator 2). Malha (5,5) -> backing (400,300) -> CSS (200,150).
  const base = {
    rect: { left: 0, top: 0, width: 400, height: 300 },
    backingWidth: 800,
    backingHeight: 600,
    transform: [60, 100, 0],
    features: feats,
  };
  it("clique escalado atinge o município certo", () => {
    expect(resolverCliqueMapa({ ...base, clientX: 200, clientY: 150 })).toBe("3550308");
  });
  it("sem a correção CSS o mesmo clique erraria (prova que a escala importa)", () => {
    // CSS (360,150): com escala -> backing (720,300) -> malha (10.33,5): fora.
    expect(resolverCliqueMapa({ ...base, clientX: 360, clientY: 150 })).toBeNull();
    // Sem escala (fator 1) o ponto cairia em (4.33,2.5): dentro — falso positivo.
    expect(hitTest(feats, (360 - 100) / 60, 150 / 60)).toBe("3550308");
  });
  it("ret degenerado retorna null", () => {
    expect(
      resolverCliqueMapa({ ...base, rect: { left: 0, top: 0, width: 0, height: 0 }, clientX: 1, clientY: 1 }),
    ).toBeNull();
  });
});

describe("fiação do clique no <canvas> (jsdom)", () => {
  it("clicar no município chama onSelectIbge com o IBGE7", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchTopo();
    try {
      const onSelectIbge = vi.fn();
      const div = document.createElement("div");
      document.body.appendChild(div);
      const root = createRoot(div);
      await act(async () => {
        root.render(
          <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={onSelectIbge} />,
        );
      });
      const canvas = div.querySelector("canvas");
      expect(canvas).not.toBeNull();
      // CSS 400x300 sobre backing 800x600 (DPR 1 no jsdom).
      canvas!.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
      await act(async () => {
        canvas!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 150 }));
      });
      expect(onSelectIbge).toHaveBeenCalledTimes(1);
      expect(onSelectIbge).toHaveBeenCalledWith("3550308");
      // Clique fora da malha não dispara.
      await act(async () => {
        canvas!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 390, clientY: 290 }));
      });
      expect(onSelectIbge).toHaveBeenCalledTimes(1);
      root.unmount();
      div.remove();
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});

describe("malha indisponível usa o mesmo fallback", () => {
  it("precisaFallback: sem canvas OU com erro de malha", () => {
    expect(precisaFallback(false, null)).toBe(true);
    expect(precisaFallback(true, "malha indisponível")).toBe(true);
    expect(precisaFallback(true, null)).toBe(false);
  });
  it("loadMalha rejeita quando o fetch falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede fora"); }));
    await expect(loadMalha("/data/malha.topojson")).rejects.toThrow();
  });
  it("fetch rejeita -> renderiza lista de UFs + link TSE, sem <canvas>", async () => {
    const restorePath = mockPath2D();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    try {
      const div = document.createElement("div");
      document.body.appendChild(div);
      const root = createRoot(div);
      await act(async () => {
        root.render(
          <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={() => {}} />,
        );
      });
      expect(div.querySelector("canvas")).toBeNull();
      const linkTse = div.querySelector('a[href="https://resultados.tse.jus.br/"]');
      expect(linkTse).not.toBeNull();
      for (const uf of UFS) {
        expect(div.textContent).toContain(uf);
      }
      expect(div.querySelector('[role="alert"]')).not.toBeNull();
      root.unmount();
      div.remove();
    } finally {
      restorePath();
    }
  });
});

describe("malha URL canônica (gerador = docs = call site)", () => {
  it("MALHA_MUNICIPIOS_URL é o path documentado/gerado", () => {
    expect(MALHA_MUNICIPIOS_URL).toBe("/data/malha_municipios.topojson");
  });
  it("Explorar usa a constante (sem /data/malha.json divergente)", () => {
    const src = fs.readFileSync("components/Explorar.tsx", "utf8");
    expect(src).toContain("MALHA_MUNICIPIOS_URL");
    expect(src).not.toContain("/data/malha.json");
  });
});

describe("contrato da seleção (IBGE7 | UF | EXTERIOR)", () => {
  it('EXTERIOR === "EXTERIOR"', () => {
    expect(EXTERIOR).toBe("EXTERIOR");
  });
  it("fallback: botão de UF passa a sigla, Exterior passa a sentinela", async () => {
    const restorePath = mockPath2D();
    mockFetchTopo();
    try {
      const onSelectIbge = vi.fn();
      const div = document.createElement("div");
      document.body.appendChild(div);
      const root = createRoot(div);
      await act(async () => {
        root.render(<MapaFallback onSelectIbge={onSelectIbge} />);
      });
      const botoes = Array.from(div.querySelectorAll("button"));
      const botaoSP = botoes.find((b) => b.textContent === "SP");
      const botaoExt = botoes.find((b) => b.textContent === "Exterior");
      expect(botaoSP).toBeDefined();
      expect(botaoExt).toBeDefined();
      botaoSP!.click();
      botaoExt!.click();
      expect(onSelectIbge).toHaveBeenNthCalledWith(1, "SP");
      expect(onSelectIbge).toHaveBeenNthCalledWith(2, "EXTERIOR");
      root.unmount();
      div.remove();
    } finally {
      restorePath();
    }
  });
});
