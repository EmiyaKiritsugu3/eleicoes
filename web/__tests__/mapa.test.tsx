import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MapaBrasil from "../components/MapaBrasil";
import { decodeTopojson, hitTest, UFS } from "../lib/malha";

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
    const g = globalThis as Record<string, unknown>;
    const prev = g["Path2D"];
    g["Path2D"] = function Path2D() {};
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
      g["Path2D"] = prev;
    }
  });
});
