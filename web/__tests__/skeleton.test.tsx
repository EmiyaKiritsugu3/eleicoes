import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Skeleton from "../components/Skeleton";

function contar(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Skeleton (placeholder display-only)", () => {
  it("N barras + style tag com keyframes (1 ocorrência)", () => {
    const html = renderToStaticMarkup(<Skeleton linhas={2} />);
    // Keyframes presentes (nome via tokens.movimento.keyframePulso).
    expect(contar(html, "skeleton-pulse")).toBeGreaterThanOrEqual(1);
    // Exatamente uma tag <style> por render.
    expect(contar(html, "<style")).toBe(1);
    // N barras pedidas.
    expect(contar(html, "<div")).toBe(2);
  });

  it("aria-hidden sem texto visível", () => {
    const html = renderToStaticMarkup(<Skeleton linhas={2} />);
    expect(html).toContain('aria-hidden="true"');
    // NUNCA texto visível dentro do aria-hidden: o "a carregar" vive no
    // chamador com role=status, não aqui.
    expect(html.toLowerCase()).not.toContain("carregar");
  });

  it("bloco 4:3 com bloco=true", () => {
    const html = renderToStaticMarkup(<Skeleton bloco={true} />);
    expect(html).toContain("4 / 3");
    expect(contar(html, "<style")).toBe(1);
  });

  it("linhas default = 3", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(contar(html, "<div")).toBe(3);
  });
});
