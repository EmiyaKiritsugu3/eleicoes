// @vitest-environment jsdom
// EVOLVE-4 Task 3: Home renderiza MapaBrasil clicável quando há malha
// (clique → foco no filtro UF); sem malha, fallback honesto na lista v1
// (tabela de votos por UF) — fail-closed, nunca canvas quebrado.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { HomeContent, ufDeSelecaoMapa } from "../components/HomeContent";
import {
  SEM_DADO,
  MANIFEST_OK,
  MANIFEST_INVALIDO,
  mockFetchHome,
  chamadasMalha,
  mockPath2D,
  mockCanvas2d,
  renderJsdom,
  teardownJsdom,
  secao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(teardownJsdom);

function renderHome(node: React.ReactElement = <HomeContent />): Promise<HTMLDivElement> {
  return renderJsdom(node);
}

function secaoMapa(html: string): string {
  return secao(html, "Mapa por UF");
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
      // Slice-2 (EVOLVE-5 Task 3): o foco UF aproxima o mapa p/ os
      // municípios da UF; p/ clicar outra UF é preciso voltar ao nível UF.
      const voltar = div.querySelector(
        'section[aria-label="Mapa por UF"] button',
      ) as HTMLButtonElement | null;
      expect(voltar).not.toBeNull();
      await act(async () => {
        voltar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const canvasUf = div.querySelector(
        'section[aria-label="Mapa por UF"] canvas',
      ) as HTMLCanvasElement | null;
      expect(canvasUf).not.toBeNull();
      const pRJ = cliqueCssParaMalha(canvasUf!, 11.5, -0.5);
      await act(async () => {
        canvasUf!.dispatchEvent(
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

describe("Home adia a malha até o mapa ser elegível (sem fetch desperdiçado)", () => {
  it("semProva: malha nem é buscada (seção suprime de todo jeito)", async () => {
    const fetchMock = mockFetchHome(MANIFEST_INVALIDO, "ok");
    const div = await renderHome();
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).not.toBe("");
    expect(mapa).toContain(SEM_DADO);
    expect(chamadasMalha(fetchMock)).toBe(0);
  });
  it("ufs vazio (filtro sem cobertura): malha nem é buscada", async () => {
    const fetchMock = mockFetchHome(MANIFEST_OK, "ok");
    const div = await renderHome(<HomeContent initialFiltros={{ uf: "XX" }} />);
    const mapa = secaoMapa(div.innerHTML);
    expect(mapa).not.toBe("");
    expect(mapa).toContain(SEM_DADO);
    expect(chamadasMalha(fetchMock)).toBe(0);
  });
  it("elegível: busca exatamente uma vez (sem regressão do single-fetch)", async () => {
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
