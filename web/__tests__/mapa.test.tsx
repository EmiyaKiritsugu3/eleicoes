// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
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
import {
  FIXTURE_TOPO_2UF as FIXTURE_2UF,
  mockPath2D,
  mockCanvas2d,
  mockFetchMalhaAusente,
  topoQuadradoUnico,
  renderJsdom,
  rerenderJsdom,
  teardownJsdom,
} from "./helpers";

// Malha fixture mínima: quadrado único 3550308 (São Paulo-SP) — builder
// compartilhado em helpers (a variante renomeada p/ rotação sai do mesmo).
const FIXTURE_TOPO = topoQuadradoUnico("São Paulo");

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(teardownJsdom);

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
    // Ponto dentro do quadrado em tela (0..10, -10..0).
    expect(hitTest(feats, 5, -5)).toBe("3550308");
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
  // Projeção do desenho em tela: s=60, ox=100, oy=600 sobre backing 800x600;
  // ret CSS 400x300 (fator 2). Malha (5,-5) -> backing (400,300) -> CSS (200,150).
  const base = {
    rect: { left: 0, top: 0, width: 400, height: 300 },
    backingWidth: 800,
    backingHeight: 600,
    transform: [60, 100, 600],
    features: feats,
  };
  it("clique escalado atinge o município certo", () => {
    expect(resolverCliqueMapa({ ...base, clientX: 200, clientY: 150 })).toBe("3550308");
  });
  it("sem a correção CSS o mesmo clique erraria (prova que a escala importa)", () => {
    // CSS (360,150): com escala -> backing (720,300) -> malha (10.33,-5): fora.
    expect(resolverCliqueMapa({ ...base, clientX: 360, clientY: 150 })).toBeNull();
    // Sem escala (fator 1) o ponto cairia em (4.33,-7.5): dentro — falso positivo.
    expect(hitTest(feats, (360 - 100) / 60, (150 - 600) / 60)).toBe("3550308");
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
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={onSelectIbge} />,
      );
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
    mockFetchMalhaAusente();
    try {
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      expect(div.querySelector("canvas")).toBeNull();
      const linkTse = div.querySelector('a[href="https://resultados.tse.jus.br/"]');
      expect(linkTse).not.toBeNull();
      for (const uf of UFS) {
        expect(div.textContent).toContain(uf);
      }
      expect(div.querySelector('[role="alert"]')).not.toBeNull();
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
      const div = await renderJsdom(<MapaFallback onSelectIbge={onSelectIbge} />);
      const botoes = Array.from(div.querySelectorAll("button"));
      const botaoSP = botoes.find((b) => b.textContent === "SP");
      const botaoExt = botoes.find((b) => b.textContent === "Exterior");
      expect(botaoSP).toBeDefined();
      expect(botaoExt).toBeDefined();
      botaoSP!.click();
      botaoExt!.click();
      expect(onSelectIbge).toHaveBeenNthCalledWith(1, "SP");
      expect(onSelectIbge).toHaveBeenNthCalledWith(2, "EXTERIOR");
    } finally {
      restorePath();
    }
  });
});

describe("orientação norte-sul (latitude × canvas)", () => {
  // Triângulo geo assimétrico: base em y=0, ápice ao NORTE (y=10).
  // Deltas: (0,0) → (10,0) → (5,10) → (0,0).
  const FIXTURE_NORTE = {
    type: "Topology",
    transform: { scale: [1, 1], translate: [0, 0] },
    objects: {
      municipios: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            properties: { ibge7: "1400100", uf: "RR", nome: "Boa Vista" },
            arcs: [[0]],
          },
        ],
      },
    },
    arcs: [
      [
        [0, 0],
        [10, 0],
        [-5, 10],
        [-5, -10],
      ],
    ],
  };
  it("norte geográfico renderiza no topo (flip Y no decode, consistente c/ hit-test)", () => {
    const feats = decodeTopojson(FIXTURE_NORTE as never);
    expect(feats).toHaveLength(1);
    const pts = feats[0].polygons.flat(2) as Array<[number, number]>;
    const ys = pts.map((p) => p[1]);
    // Ápice norte (y=10 geo) deve ter o MENOR y de tela (topo do canvas).
    expect(Math.min(...ys)).toBe(-10);
    // Hit-test consistente com o desenho: ponto norte (tela) atinge…
    expect(hitTest(feats, 5, -9)).toBe("1400100");
    // …e o espelho sul (orientação sem flip) erra.
    expect(hitTest(feats, 5, 9)).toBeNull();
  });
});

describe("furos de polígono (shell menos buracos)", () => {
  // Quadrado (0,0)-(10,10) com furo (3,3)-(7,7); cada arco decodifica do zero.
  const FIXTURE_FURO = {
    type: "Topology",
    transform: { scale: [1, 1], translate: [0, 0] },
    objects: {
      municipios: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            properties: { ibge7: "3550308", uf: "SP", nome: "São Paulo" },
            arcs: [[0], [1]],
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
        [3, 3],
        [0, 4],
        [4, 0],
        [0, -4],
        [-4, 0],
      ],
    ],
  };
  it("clique dentro do furo não seleciona o município", () => {
    const feats = decodeTopojson(FIXTURE_FURO as never);
    expect(feats).toHaveLength(1);
    // Dentro da casca, fora do furo (coords de tela, y negado).
    expect(hitTest(feats, 1, -1)).toBe("3550308");
    // Dentro do furo (5,-5) → fora.
    expect(hitTest(feats, 5, -5)).toBeNull();
  });
});

describe("decode sem transform (arcos absolutos)", () => {
  const FIXTURE_SEM_TRANSFORM = {
    type: "Topology",
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
        [2, 3],
        [8, 1],
      ],
    ],
  };
  it("retorna pontos absolutos com flip Y (sem acumular deltas)", () => {
    const feats = decodeTopojson(FIXTURE_SEM_TRANSFORM as never);
    expect(feats).toHaveLength(1);
    expect(feats[0].polygons).toEqual([
      [
        [
          [2, -3],
          [8, -1],
        ],
      ],
    ]);
  });
});

describe("malha vazia falha fechado", () => {
  it("loadMalha rejeita malha decodificada vazia (ativa o fallback em lista)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          type: "Topology",
          objects: { municipios: { type: "GeometryCollection", geometries: [] } },
          arcs: [],
        }),
      })),
    );
    await expect(loadMalha("/data/malha.topojson")).rejects.toThrow(/sem dado oficial/);
  });
});

// Dois vizinhos: SP (0,0)-(10,10) + faixa a leste (11,0)-(12,1).
// Com zoom em SP, a faixa cai dentro do canvas mas não é desenhada.
// (Topologia em ./helpers — FIXTURE_TOPO_2UF, fonte única.)

function mockFetchTopo2() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => FIXTURE_2UF })),
  );
}

describe("zoom UF filtra o hit-test (só o desenhado)", () => {
  it("clique na área em branco (município vizinho não desenhado) não seleciona", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchTopo2();
    try {
      const onSelectIbge = vi.fn();
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="municipio" ufSelecionada="SP" onSelectIbge={onSelectIbge} />,
      );
      const canvas = div.querySelector("canvas");
      expect(canvas).not.toBeNull();
      canvas!.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
      // Zoom SP em tela (pós-flip Y): s=60, ox=100, oy=600
      // (bbox SP em tela: x 0..10, y -10..0).
      // Malha (11.5,0.5) geo = faixa RJ: sem o filtro de zoom o hit-test
      // a alcançaria em backing (790,30) -> CSS (395,15); com o filtro, null.
      // (Em tela pós-flip esse ponto cai em (11.5,-9.5): branco de todo jeito.)
      await act(async () => {
        canvas!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 395, clientY: 15 }));
      });
      expect(onSelectIbge).not.toHaveBeenCalled();
      // Sanidade: centro de SP (malha 5,-5 -> backing 400,300 -> CSS 200,150) seleciona.
      await act(async () => {
        canvas!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 150 }));
      });
      expect(onSelectIbge).toHaveBeenCalledTimes(1);
      expect(onSelectIbge).toHaveBeenCalledWith("3550308");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});

describe("rotação de manifest não gruda no mapa velho (decisão EVOLVE-6 T6-b)", () => {
  // Mesma geometria, município renomeado: só o sync featuresProp→estado
  // atualiza o <select> de teclado (pré-fix: estado inicial gruda em A).
  it("features novas do chamador substituem o estado (sem stale)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    try {
      const featsA = decodeTopojson(FIXTURE_TOPO as never);
      const featsB = decodeTopojson(topoQuadradoUnico("Campinas") as never);
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="municipio" ufSelecionada="SP" features={featsA} onSelectIbge={() => {}} />,
      );
      expect(div.textContent).toContain("São Paulo");
      // Rotação: chamador resolveu features novas e repassa.
      await rerenderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="municipio" ufSelecionada="SP" features={featsB} onSelectIbge={() => {}} />,
      );
      expect(div.textContent).toContain("Campinas");
      expect(div.textContent).not.toContain("São Paulo");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
  it("erro anterior limpa quando a malha chega (fallback não gruda)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchMalhaAusente();
    try {
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      // Falhou: fallback em lista, sem canvas.
      expect(div.querySelector("canvas")).toBeNull();
      // Rotação: chamador entrega as features (malha surgiu) — canvas volta.
      const feats = decodeTopojson(FIXTURE_TOPO as never);
      await rerenderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" features={feats} onSelectIbge={() => {}} />,
      );
      expect(div.querySelector("canvas")).not.toBeNull();
    } finally {
      restorePath();
      restoreCtx();
    }
  });
  it("nova malhaUrl tenta de novo após falha (refetch na rotação)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchMalhaAusente();
    try {
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/v1.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      expect(div.querySelector("canvas")).toBeNull();
      // Rotação: URL nova + malha disponível — refetch recupera o canvas.
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => FIXTURE_TOPO })));
      await rerenderJsdom(
        <MapaBrasil malhaUrl="/data/v2.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      expect(div.querySelector("canvas")).not.toBeNull();
    } finally {
      restorePath();
      restoreCtx();
    }
  });
  it("fallback segue visível durante o refetch pendente (só limpa no sucesso)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchMalhaAusente();
    try {
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/v1.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      // Falhou: fallback em lista, sem canvas.
      expect(div.querySelector("canvas")).toBeNull();
      // Rotação com fetch ainda pendente: fallback mantido, sem canvas vazio.
      let resolver!: (v: unknown) => void;
      const pendente = new Promise((res) => {
        resolver = res;
      });
      vi.stubGlobal("fetch", vi.fn(() => pendente));
      await rerenderJsdom(
        <MapaBrasil malhaUrl="/data/v2.topojson" nivel="uf" onSelectIbge={() => {}} />,
      );
      expect(div.querySelector("canvas")).toBeNull();
      expect(div.querySelector('[role="alert"]')).not.toBeNull();
      // Sucesso resolve: canvas volta.
      await act(async () => {
        resolver({ ok: true, json: async () => FIXTURE_TOPO });
      });
      for (let i = 0; i < 8; i++) {
        await act(async () => {});
      }
      expect(div.querySelector("canvas")).not.toBeNull();
    } finally {
      restorePath();
      restoreCtx();
    }
  });
});

describe("operável por teclado (lista junto ao mapa)", () => {
  it("zoom UF: <select> de municípios chama onSelectIbge", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchTopo2();
    try {
      const onSelectIbge = vi.fn();
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="municipio" ufSelecionada="SP" onSelectIbge={onSelectIbge} />,
      );
      const sel = div.querySelector('select[aria-label="Escolher município (teclado)"]') as HTMLSelectElement | null;
      expect(sel).not.toBeNull();
      await act(async () => {
        sel!.value = "3550308";
        sel!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onSelectIbge).toHaveBeenCalledWith("3550308");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
  it("nível UF: <select> de UFs chama onSelectIbge com a sigla", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchTopo2();
    try {
      const onSelectIbge = vi.fn();
      const div = await renderJsdom(
        <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" onSelectIbge={onSelectIbge} />,
      );
      const sel = div.querySelector('select[aria-label="Escolher UF (teclado)"]') as HTMLSelectElement | null;
      expect(sel).not.toBeNull();
      await act(async () => {
        sel!.value = "SP";
        sel!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onSelectIbge).toHaveBeenCalledWith("SP");
    } finally {
      restoreCtx();
      restorePath();
    }
  });
});
