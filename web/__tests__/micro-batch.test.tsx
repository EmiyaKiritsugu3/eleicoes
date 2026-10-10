// @vitest-environment jsdom
// EVOLVE-6 Task 3 — micro-batch morto: 1 teste por item (a,b,c,d,f).
// Item (e) — doc 1-liner raw quarantine pré-gate — vive em
// tests/etl/test_microbatch_task3.py (docstring de `quarantine_invalid_csvs`).
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import MapaBrasil from "../components/MapaBrasil";
import { EXTERIOR, decodeTopojson } from "../lib/malha";
import { entryDate } from "../lib/data";
import { mockPath2D, mockCanvas2d } from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

describe("task3 micro-batch morto", () => {
  it("(a) sem `void c` morto em Verificar/Curada", () => {
    expect(read("app/verificar/Verificar.tsx")).not.toMatch(/void c;/);
    expect(read("app/perguntas/Curada.tsx")).not.toMatch(/void c;/);
  });

  it("(b) EXTERIOR_IBGE removido, EXTERIOR mantido", () => {
    expect(read("lib/malha.ts")).not.toContain("EXTERIOR_IBGE");
    expect(EXTERIOR).toBe("EXTERIOR");
  });

  it("(c) teclado trim: valor com espaços chega aparado (paridade Explorar)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    try {
      const onSelectIbge = vi.fn();
      const div = document.createElement("div");
      document.body.appendChild(div);
      const root = createRoot(div);
      await act(async () => {
        root.render(
          <MapaBrasil malhaUrl="/data/malha.topojson" nivel="uf" features={[]} onSelectIbge={onSelectIbge} />,
        );
      });
      const sel = div.querySelector('select[aria-label="Escolher UF (teclado)"]') as HTMLSelectElement | null;
      expect(sel).not.toBeNull();
      const opt = document.createElement("option");
      opt.value = "  SP  ";
      opt.textContent = "SP";
      sel!.appendChild(opt);
      await act(async () => {
        sel!.value = "  SP  ";
        sel!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onSelectIbge).toHaveBeenCalledWith("SP");
      root.unmount();
      div.remove();
    } finally {
      restoreCtx();
      restorePath();
    }
  });

  it("(d) entryDate valida ISO (raw não-ISO cai p/ vazio fail-closed)", () => {
    expect(entryDate({ date: "2026-01-01" })).toBe("2026-01-01");
    expect(entryDate({ data: "2026-10-10T12:00:00Z" })).toBe("2026-10-10T12:00:00Z");
    expect(entryDate({ date: "  2026-01-01  " })).toBe("2026-01-01");
    expect(entryDate({ date: "ontem" })).toBe("");
    expect(entryDate({ date: "javascript:alert(1)" })).toBe("");
    expect(entryDate({})).toBe("");
    // Round-trip calendário: Date.parse transborda 2026-02-30 → Mar 02.
    expect(entryDate({ date: "2026-02-30" })).toBe("");
    expect(entryDate({ date: "2026-02-30T12:00:00Z" })).toBe("");
    expect(entryDate({ date: "2026-13-01" })).toBe("");
    expect(entryDate({ date: "2026-02-29" })).toBe("");
    expect(entryDate({ date: "2024-02-29" })).toBe("2024-02-29");
  });

  it("(f) decodeTopojson conta skips c/ debug warn e segue fail-closed", () => {
    const dbg = vi.spyOn(console, "debug").mockImplementation(() => {});
    const topo = {
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
            { type: "Point", properties: { ibge7: "0000000" } },
            {
              type: "Polygon",
              properties: { ibge7: "", uf: "SP", nome: "Sem IBGE" },
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
    const feats = decodeTopojson(topo as never);
    expect(feats).toHaveLength(1);
    expect(feats[0].ibge7).toBe("3550308");
    expect(dbg).toHaveBeenCalledWith(expect.stringMatching(/2.*ignora|ignora.*2/));
  });
});
