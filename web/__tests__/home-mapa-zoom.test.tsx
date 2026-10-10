// @vitest-environment jsdom
// EVOLVE-5 Task 3 (RED): Home UF-focus → zoom nivel="municipio" + ufSelecionada
// (reuse filtro MapaBrasil); voltar drills out. EXTERIOR oculto; hash gate intacto.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { HomeContent } from "../components/HomeContent";
import {
  MANIFEST_OK,
  MANIFEST_INVALIDO,
  mockFetchHome,
  mockPath2D,
  mockCanvas2d,
  renderJsdom,
  teardownJsdom,
  secao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(teardownJsdom);

function secaoMapa(html: string): string {
  return secao(html, "Mapa por UF");
}

function cliqueCssParaMalha(canvas: HTMLCanvasElement, mx: number, my: number) {
  const t = JSON.parse(canvas.dataset.transform as string) as number[];
  const [s, ox, oy] = t;
  return { x: (mx * s + ox) / 2, y: (my * s + oy) / 2 };
}

function canvasMapa(div: HTMLDivElement): HTMLCanvasElement | null {
  return div.querySelector('section[aria-label="Mapa por UF"] canvas') as HTMLCanvasElement | null;
}

function rect400(canvas: HTMLCanvasElement) {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
}

describe("Home zoom UF→município (slice-2)", () => {
  it("clique na UF aproxima p/ canvas municipal (select de município + voltar)", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderJsdom(<HomeContent />);
      const canvas = canvasMapa(div);
      expect(canvas).not.toBeNull();
      rect400(canvas!);
      const pSP = cliqueCssParaMalha(canvas!, 5, -5);
      await act(async () => {
        canvas!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: pSP.x, clientY: pSP.y }),
        );
      });
      const mapa = secaoMapa(div.innerHTML);
      expect(mapa).toContain("<canvas");
      expect(mapa).toContain("Escolher município (teclado)");
      expect(mapa).not.toContain("Escolher UF (teclado)");
      expect(mapa).toContain("Voltar para todas as UFs");
      expect(mapa).not.toContain("Exterior");
    } finally {
      restoreCtx();
      restorePath();
    }
  });

  it("seleção por teclado foca a UF e aproxima; voltar afasta", async () => {
    const restorePath = mockPath2D();
    const restoreCtx = mockCanvas2d();
    mockFetchHome(MANIFEST_OK, "ok");
    try {
      const div = await renderJsdom(<HomeContent />);
      const selUf = div.querySelector(
        'section[aria-label="Mapa por UF"] select[aria-label="Escolher UF (teclado)"]',
      ) as HTMLSelectElement | null;
      expect(selUf).not.toBeNull();
      await act(async () => {
        selUf!.value = "RJ";
        selUf!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      let mapa = secaoMapa(div.innerHTML);
      expect(mapa).toContain("Escolher município (teclado)");
      const ufInput = div.querySelector(
        'section[aria-label="Busca"] input[aria-label="uf"]',
      ) as HTMLInputElement | null;
      expect(ufInput!.value).toBe("RJ");
      const voltar = div.querySelector(
        'section[aria-label="Mapa por UF"] button',
      ) as HTMLButtonElement | null;
      expect(voltar?.textContent).toContain("Voltar para todas as UFs");
      await act(async () => {
        voltar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      mapa = secaoMapa(div.innerHTML);
      expect(mapa).toContain("Escolher UF (teclado)");
      expect(ufInput!.value).toBe("");
    } finally {
      restoreCtx();
      restorePath();
    }
  });

  it("gate de hash intacto: sem prova, sem canvas mesmo com foco UF", async () => {
    mockFetchHome(MANIFEST_INVALIDO, "ok");
    const div = await renderJsdom(<HomeContent initialFiltros={{ uf: "SP" }} />);
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).toContain("sem dado oficial");
    expect(mapa).not.toContain("<canvas");
  });
});
