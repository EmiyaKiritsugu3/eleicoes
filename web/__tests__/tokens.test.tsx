import { describe, expect, it } from "vitest";
import { tokens } from "../lib/tokens";

// Razão de contraste WCAG 2.x via luminância relativa (só matemática pura,
// SSR-safe). Pares cobertos: tinta/fundo e verde/fundo (AA texto ≥ 4.5).
function luminancia(hex: string): number {
  const m = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

describe("tokens editoriais", () => {
  it("paleta exata da spec", () => {
    expect(tokens.cor.fundo).toBe("#FAF7F0");
    expect(tokens.cor.tinta).toBe("#1A1A18");
    expect(tokens.cor.destaqueVerde).toBe("#0B6B3A");
    expect(tokens.cor.destaqueAmarelo).toBe("#F2B705");
  });
  it("display serifada com fallback genérico no fim", () => {
    expect(tokens.fonte.display).toMatch(/Georgia/);
    expect(tokens.fonte.display.trim().endsWith("serif")).toBe(true);
  });
  it("contraste AA tinta/fundo e verde/fundo", () => {
    expect(contraste(tokens.cor.tinta, tokens.cor.fundo)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contraste(tokens.cor.destaqueVerde, tokens.cor.fundo),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
